# Minimal Automation Primitives

## Goal

TeamCopilot should let users build complex automations by talking to the AI agent, while keeping the platform primitives small enough to stay understandable.

The minimal foundation is:

- Scheduled jobs: run something later or repeatedly.
- Hosted services: keep code running and optionally expose HTTP endpoints.
- Workflow runs: run finite scripts to completion.
- Resource-owned data directories: remember data across runs, services, restarts, and resumes without expanding the TeamCopilot SDK.

Everything else should be a protocol on top of those primitives:

- Structured workflow results.
- Blocking shared SDK calls for agent-mediated user conversations.
- Blocking shared SDK calls for bounded agent work.
- Optional workflow-to-workflow composition for genuinely reusable finite automations.
- Agent-authored draft resources.

This avoids a large provider-specific monitor framework while still allowing WhatsApp bots, log monitors, GitHub bots, internal APIs, polling jobs, and approval workflows.

## Component Minimization Rule

Default to the fewest components that can express the automation clearly:

- If an event starts in a hosted service, keep the logic in that service unless there is a strong reason to create a reusable finite workflow.
- A service can call `tc.ask_user` directly. It does not need a workflow just to ask for approval.
- A service can call `tc.run_agent` directly. It does not need a workflow just to start an agent.
- A workflow can call `tc.ask_user` and `tc.run_agent` directly. It does not need child workflows for ordinary checks, API calls, or side effects.
- Use `tc.call_workflow` only when the called workflow is a meaningful reusable automation package, not as a way to structure normal code.
- Prefer one service for webhook/server automations and one workflow for scheduled/manual finite automations.

## What To Minimize

Do not introduce a generic event bus as a first version primitive.

For v1, services, cronjobs, and workflows can use the shared `tc` SDK directly. Resource-owned data directories are enough for cursors, dedupe keys, thread ids, and other bookkeeping. If we later need fanout, subscriptions, replay, or cross-resource event routing, we can add an event log then.

Do not introduce provider-specific abstractions like `whatsapp_monitor`, `slack_monitor`, or `event_handler`.

The agent should build those as compositions of services, cronjobs, workflows, and resource-owned data files.

## Primitive 1: Scheduled Jobs

Scheduled jobs already exist as cronjobs.

Purpose:

```text
Run code on a schedule.
```

Examples:

- Check server logs every 5 minutes.
- Poll an API every hour.
- Run a daily report.

Scheduled jobs should be able to:

- Run a tc.
- Run an agent session with the existing todo-driven cronjob loop.
- Call a hosted tc.

We should reuse the existing cronjob system rather than building a new scheduler.

Cronjobs should keep two first-class target modes:

```text
workflow target:
  deterministic scheduled code

agent target:
  scheduled OpenCode agent session with the custom todo protocol and user handoff
```

The current `target_type = "prompt"` path maps to the agent target. It should remain because it supports scheduled autonomous agent work, todo planning, hidden sessions, `askCronjobUser`, reveal-to-user, pause, resume, and final review.

Agent cronjob chat messages should be distinguishable from normal assistant chat messages. When the scheduled agent writes into a chat session, TeamCopilot should store or expose those messages with a separate role or role metadata, for example `cronjob_agent`, so the UI and audit trail can tell scheduled automation apart from interactive assistant replies.

The main cleanup needed is saved todos. Today initial todo steps are encoded into the prompt text. Replace that with real database rows.

Suggested table:

```prisma
model cronjob_todo_templates {
  id          String @id @default(uuid())
  cronjob_id  String
  content     String
  position    Int
  created_at  BigInt
  updated_at  BigInt

  @@index([cronjob_id, position])
}
```

Behavior:

- `cronjobs.prompt` stores only the user-facing task prompt.
- `cronjob_todo_templates` stores saved initial todo steps for future runs.
- When an agent cronjob run starts, TeamCopilot copies templates into `cronjob_run_todos`.
- Runtime todo changes still live in `cronjob_run_todos`.
- Existing base64/encoded todo prompts should be migrated into `cronjob_todo_templates` and then removed from the prompt.
- New cronjob create/update APIs should accept `initial_todos` as a structured array, not as encoded prompt content.

## Primitive 2: Hosted Services

Hosted services are long-running processes managed by TeamCopilot.

Purpose:

```text
Keep user-authored code running and optionally reachable over HTTP.
```

Filesystem shape:

```text
services/
  whatsapp-listener/
    service.json
    server.py
    requirements.txt
```

Example `service.json`:

```json
{
  "name": "WhatsApp Listener",
  "runtime": "python",
  "entrypoint": "server.py",
  "port": 7001,
  "public_path": "/services/whatsapp-listener",
  "required_secrets": ["WHATSAPP_WEBHOOK_SECRET", "WHATSAPP_ACCESS_TOKEN"]
}
```

TeamCopilot responsibilities:

- Start, stop, restart.
- Capture logs.
- Inject declared secrets.
- Reverse-proxy `public_path` to the local port.
- Require approved code before start or public exposure.
- Stop or block restart when approved code changes.

Defer for later unless needed:

- Healthchecks.
- Restart policies.
- Resource limits.
- Multiple replicas.
- Container isolation.

Those are useful, but they are not needed to prove the primitive.

## Primitive 3: Workflow Runs

Workflows already exist and remain the primitive for finite execution.

Purpose:

```text
Run code now, finish, and return a result.
```

Examples:

- Scan logs and decide whether to alert.
- Generate a report.
- Process a manually triggered refund approval.
- Run a scheduled churn-risk review.

Workflows keep using args the same way they do today. If a workflow needs the user, it calls `tc.ask_user(instruction_to_agent, user_id)` and blocks until the user replies. If a workflow needs another workflow, it calls `tc.call_workflow(slug, args)` and blocks until that workflow finishes. If it needs an agent to do bounded work, it calls `tc.run_agent(instruction)` and blocks until the agent returns a structured result.

This version does not add a separate workflow state file, file-path argument, or continuation args. The Python process keeps its local call stack while helper calls wait.

## Optional Workflow Composition

A workflow or service should be able to call another workflow and consume its terminal result while preserving local Python context. This should not be the default decomposition tool. Use it only when the called workflow is a meaningful reusable automation package with its own approval, audit trail, secrets, and terminal result.

Minimal helper:

```python
result = tc.call_workflow("child-workflow-slug", {
    "customer_id": "123",
    "order_id": "456"
})
```

Behavior:

- The current script process stays alive.
- TeamCopilot starts the child workflow with the provided args.
- If the child workflow calls `tc.ask_user`, TeamCopilot handles that interaction and continues the child until it reaches a terminal state.
- The SDK helper polls TeamCopilot until the child reaches a terminal state.
- The helper returns the child result to the caller.
- TeamCopilot stores the intermediate child result in the DB while the caller is waiting.
- TeamCopilot clears the intermediate child result after the caller finishes, or after a service request scope is complete.

The child workflow's terminal result is one of:

- `success`
- `failed`

Returned result format:

```json
{
  "call_id": "call_123",
  "called_workflow_slug": "child-workflow-slug",
  "called_run_id": "run_456",
  "status": "success",
  "output": {
    "label": "billing"
  }
}
```

Failed child result:

```json
{
  "call_id": "call_123",
  "called_workflow_slug": "child-workflow-slug",
  "called_run_id": "run_456",
  "status": "failed",
  "error": "Could not classify message"
}
```

Caller shape:

```python
result = tc.call_workflow("child-workflow-slug", {"message": text})

if result["status"] == "success":
    label = result["output"]["label"]
    ...
else:
    tc.fail(result["error"])
```

This keeps workflow code natural. Loops, local variables, and exception handling stay intact because the parent process is not restarted.

Intermediate child workflow results are runtime bookkeeping, not durable workflow output. They should be deleted after the caller finishes.

## Primitive 4: Resource-Owned Data

Resource-owned data is plain files written by the workflow or service itself.

Purpose:

```text
Remember data between runs.
```

Examples:

- Last log offset.
- Last seen webhook id.
- Dedupe keys.
- External thread mapping.
- OAuth cursors.
- Service configuration.

Suggested filesystem shape:

```text
workflows/check-prod-logs/data/last_offset.txt
workflows/check-database-drift/data/last_drift_hash.txt
services/oauth-callback/data/oauth_accounts.json
```

Workflow example:

```python
from pathlib import Path

data_dir = Path("data")
data_dir.mkdir(exist_ok=True)
offset_path = data_dir / "last_offset.txt"
last_offset = int(offset_path.read_text()) if offset_path.exists() else 0
offset_path.write_text(str(next_offset))
```

TeamCopilot does not need a state SDK for v1. The SDK stays minimal, and workflows/services own their file formats directly.

## Shared SDK

There should be one Python SDK namespace used by both workflows and hosted services:

```python
from teamcopilot import tc
```

Shared functions:

```text
tc.ask_user(instruction_to_agent, user_id) -> user_reply
tc.call_workflow(slug, args) -> result
tc.run_agent(instruction) -> result
tc.success(output)
tc.fail(error)
```

Runtime behavior:

- `tc.ask_user` works in workflows and services.
- `tc.call_workflow` works in workflows and services, but should only be used for a genuinely reusable finite automation boundary.
- `tc.run_agent` works in workflows and services, and is the clean way to ask an agent to do bounded work like PR review, research, classification, drafting, or investigation.
- `tc.success` and `tc.fail` are valid only inside workflow runs because only workflows have a terminal run result.
- In a hosted service request handler, normal Python/HTTP return values are used instead of `tc.success` and `tc.fail`.

This avoids separate `workflow.` and `service.` namespaces. The SDK can detect its runtime context from environment variables injected by TeamCopilot.

## Agent Prompt Injection

`tc.run_agent` and `tc.ask_user` should pass their instructions to the spawned/reused agent as system-prompt material, not as ordinary user chat messages.

Reason:

- These instructions are operational control instructions from the script.
- The agent should treat them as task authority, not as user-authored chat content.
- The instruction may include structured context, expected output schema, callback ids, approval ids, or resume instructions.
- The user-facing chat should stay focused on what the agent asks the human, not the full internal automation payload.

For `tc.run_agent`, the single `instruction` string should include everything the agent needs:

```python
review = tc.run_agent(f"""
Review this GitHub PR and return JSON findings.

Repository: acme/app
Pull request: 123
Changed files:
{changed_files_json}

Return JSON with:
{{
  "summary": "...",
  "approval_recommended": true,
  "findings": []
}}
""")
```

For `tc.ask_user`, `instruction_to_agent` should include everything the agent needs to ask the specific human and return the final answer:

```python
answer = tc.ask_user(
    f"""
    Ask the finance lead whether to approve this refund.

    Refund:
    {refund_json}

    If approved, return exactly: approve
    Otherwise return the reason or requested changes.
    """,
    user_id=finance_user_id,
)
```

TeamCopilot should wrap these into an agent system prompt with platform metadata such as request id, caller id, expected callback tool, and output expectations.

## Workflow Result Protocol

Workflow terminal results should be structured:

```ts
type WorkflowResult =
  | {
      status: "success";
      output?: unknown;
    }
  | {
      status: "failed";
      error: string;
    };
```

Existing stdout/stderr logs should still be captured. The structured result is only for platform control flow.

Python helper:

```python
from teamcopilot import tc

reply = tc.ask_user("""
Ask the user what reply should be sent.
""", user_id="user_123")

child_result = tc.call_workflow("classify-message", {
    "message": reply
})

agent_result = tc.run_agent(
    "Review PR 123 in acme/app and return JSON findings."
)

tc.success({"ok": True})
tc.fail("Could not process request")
```

## Ask User

When a workflow or service calls `tc.ask_user`, TeamCopilot stores the instruction in the DB, opens or reuses an agent chat session for the specified user, and the SDK helper polls until the user replies.

Suggested table:

```prisma
model automation_user_requests {
  id                   String @id @default(uuid())
  caller_type           String
  caller_id             String
  user_id              String
  status               String
  instruction_to_agent  String
  answer_text           String?
  session_id            String?
  opencode_session_id   String?
  created_at            BigInt
  answered_at           BigInt?

  @@index([caller_type, caller_id])
  @@index([user_id, status])
  @@index([opencode_session_id, status])
}
```

The caller should encode everything the agent needs to know in `instruction_to_agent`, including:

- The question the agent should ask the user.
- The user id of the person the agent should ask.
- Any context the agent needs to continue correctly.
- Any branch-specific instructions for the user reply.

TeamCopilot should give the agent a tool to complete the request:

```ts
answerWorkflowUserRequest({
  request_id: string;
  answer: string;
})
```

The message sent to the agent should include the request id and explicitly instruct the agent to call `answerWorkflowUserRequest` after the user has answered.

Suggested parent run status while blocked:

```text
waiting_for_user
```

Behavior:

```text
script calls tc.ask_user
  -> TeamCopilot creates automation_user_requests row
  -> agent asks the user identified by the instruction
  -> user replies in the agent chat
  -> agent calls answerWorkflowUserRequest
  -> TeamCopilot stores the reply in automation_user_requests
  -> SDK helper polling sees the reply
  -> SDK helper returns the reply string to the script
  -> script continues from the same stack frame
  -> TeamCopilot clears the intermediate reply after the caller finishes, or after a service request scope is complete
```

This preserves normal local Python variables and stack context. It is less restart-durable than the previous state-machine design, but it is much simpler for workflow authors.

Intermediate user replies are runtime bookkeeping, not durable workflow output. They should be deleted after the workflow reaches `success` or `failed`, or after a service request scope completes.

## Hosted Services With Shared SDK

A webhook service can receive a request, do the work locally, ask a user when needed, run an agent when needed, and return an HTTP response. It does not need to hand off to a workflow just because approval or agent work is needed.

Example:

```python
from teamcopilot import tc

@app.post("/webhook")
def webhook():
    event = parse_provider_payload(request)
    draft = tc.run_agent(f"""
    Draft a customer-safe reply for this event.

    Event:
    {event}

    Return JSON with:
    {{
      "reply": "...",
      "needs_approval": true
    }}
    """)
    approval = tc.ask_user(
        "Ask the support lead whether to send this reply: " + draft["reply"],
        user_id="user_support_lead"
    )
    if approval.strip().lower() == "approve":
        send_reply(event, draft["reply"])
    return {"ok": True, "approval": approval}
```

## Agent-Authored Automation

The AI agent composes these primitives.

It also needs a user lookup tool so it can resolve the `user_id` before writing a service or workflow that calls `tc.ask_user`.

Minimum agent-facing user tools:

- `list_users`: list users in TeamCopilot with id, name, email, and role.
- `find_user`: search users by name or email and return matching ids.

For:

```text
When I get a new WhatsApp message, process it. If approval is needed, message me first.
```

The agent creates:

- `services/whatsapp-listener/` for the webhook.
- Service logic that calls `tc.run_agent` to draft or classify the reply.
- Service logic that calls `tc.ask_user` when approval is needed.
- Service logic that includes the target `user_id` in `tc.ask_user`.
- Service data directory usage for dedupe and external thread mapping.
- Required secret declarations.

For:

```text
Check the logs in my server periodically. If this error appears, send me a Slack message.
```

The agent creates:

- A cronjob.
- A workflow that scans logs.
- Workflow data directory usage for last log offset.
- Workflow logic that calls `tc.ask_user` when the alert needs user confirmation.
- Workflow logic that includes the target `user_id` in `tc.ask_user`.
- Required secret declarations.

Agent-authored resources start as drafts. They become runnable only after validation, missing-secret checks, and approval.

## Approval And Safety

Use the existing resource approval snapshot model for:

```text
resource_kind = "service"
resource_kind = "workflow"
resource_kind = "cronjob"
```

Rules:

- Services need approval before start or public routing.
- Workflows need approval before unattended execution.
- Cronjobs need approval before scheduled execution.
- Required secrets must be present before execution.
- Services and workflows can only ask the user through `tc.ask_user`; the agent handles the conversation and returns the reply to the blocked SDK helper.

## Runtime Secret Resolution

Services, workflows, and cronjobs should declare required environment keys in their manifest or database definition.

At runtime, TeamCopilot should resolve those keys from the creator's profile first, then fall back to global secrets:

```text
resolve_runtime_secret(resource_creator_user_id, key):
  1. use the creator user's secret if present
  2. otherwise use the global secret if present
  3. otherwise fail the run/start with a missing secret error
```

This applies to:

- Hosted services started from `services/<slug>/service.json`.
- Workflow runs started manually, by a service, by another workflow, or by a cronjob.
- Cronjob executions, including workflow-target cronjobs and agent-target cronjobs.

Ownership rules:

- Every service, workflow, and cronjob must have a `created_by_user_id`.
- Secret resolution uses the resource creator, not the user who happens to trigger the run.
- If an agent creates a resource on behalf of a user, that user becomes the resource creator for secret resolution.
- Runtime env vars should only include declared required secrets.
- Secret values should be injected into the process environment and should not be written into prompts, logs, files, or resource definitions.

## Use Cases

These examples are intentionally different from each other. The point is to verify that the primitive set is generic enough without introducing a dedicated platform abstraction for each domain.

1. WhatsApp reply approval

```text
hosted service receives WhatsApp webhook
  -> service verifies provider signature
  -> service dedupes message id using its data directory
  -> service calls tc.run_agent to draft/classify a reply
  -> service calls tc.ask_user if approval is needed
  -> TeamCopilot opens or reuses an agent chat session
  -> agent asks the user what should happen next
  -> user replies in chat
  -> service receives the reply and sends the WhatsApp message
```

Primitives used:

- Hosted service for webhook.
- Service data directory for dedupe and thread mapping.
- Shared SDK for agent drafting and user approval.
- Agent chat for user interaction.

2. Server log monitor

```text
cronjob runs every 5 minutes
  -> workflow reads last log offset from its data directory
  -> workflow fetches new logs over SSH or HTTP
  -> workflow updates last offset
  -> workflow returns success if no issue
  -> workflow calls tc.ask_user if the agent should confirm an alert or ask for a next step
```

Primitives used:

- Scheduled job for periodic checks.
- Workflow for log scanning.
- Workflow data directory for cursor/offset.
- Agent chat for alert confirmation.

3. GitHub PR review bot

```text
hosted service receives GitHub webhook
  -> service dedupes delivery id using its data directory
  -> service fetches changed files
  -> service calls tc.run_agent for structured PR review
  -> service posts inline comments if findings exist
  -> service approves the PR if no findings are found
```

Primitives used:

- Hosted service for GitHub webhook.
- Service data directory for delivery dedupe.
- Shared SDK for bounded agent review.

4. Daily customer report

```text
cronjob runs every morning
  -> workflow queries database/API
  -> workflow generates report
  -> workflow calls tc.ask_user if the report needs approval
  -> workflow sends the email directly if approved
```

Primitives used:

- Scheduled job for daily execution.
- Workflow for report generation.
- Agent chat for report delivery confirmation.
- Workflow data directory if the report needs last-run metadata.

5. Stripe payment failure handler

```text
hosted service receives Stripe webhook
  -> service loads customer context
  -> service ignores low-value failures
  -> service calls tc.ask_user for account-owner and finance approval
  -> service sends follow-up email directly if approved
```

Primitives used:

- Hosted service for webhook.
- Shared SDK for approval.
- Agent chat for the follow-up decision.

6. Internal support triage API

```text
hosted service exposes /triage
  -> internal tool posts support ticket text
  -> service classifies urgency and owner locally or with tc.run_agent
  -> service responds to caller with classification
```

Primitives used:

- Hosted service for HTTP API.
- Shared SDK if agent classification is useful.
- Service data directory if prior ticket context is needed.

No new monitor abstraction is required because this is just a small hosted API.

7. Database drift checker

```text
cronjob runs hourly
  -> workflow introspects database schema
  -> workflow compares against expected schema in repo
  -> workflow stores last seen drift hash in its data directory
  -> workflow returns success if unchanged
  -> workflow calls tc.ask_user if the agent should confirm creating an issue
```

Primitives used:

- Scheduled job for hourly checks.
- Workflow for diffing schema.
- Workflow data directory for suppressing duplicate alerts.
- Agent chat for issue confirmation.

8. OAuth callback and token refresher

```text
hosted service receives OAuth callback
  -> service stores non-secret account metadata in its data directory
  -> service uses platform secrets for tokens
  -> cronjob periodically runs refresh-token workflow
  -> workflow refreshes token and updates stored metadata
```

Primitives used:

- Hosted service for callback.
- Service data directory for account/cursor metadata.
- Scheduled job for refresh.
- Workflow for token refresh logic.

Secret values should still live in TeamCopilot secrets, not resource-owned data files.

9. File drop processor

```text
hosted service exposes upload endpoint
  -> user/system uploads a file
  -> service writes file into its data directory or managed storage
  -> service extracts data locally or with tc.run_agent
  -> service calls tc.ask_user if ambiguous
  -> agent asks the user for clarification
  -> user replies
  -> service receives the clarification and imports the file
```

Primitives used:

- Hosted service for upload endpoint.
- Service data directory for upload metadata.
- Shared SDK for extraction and clarification.
- Agent chat for ambiguity resolution.

10. Incident responder

```text
hosted service receives monitoring webhook
  -> service dedupes alert fingerprint using its data directory
  -> service calls tc.run_agent for diagnostics
  -> service calls tc.ask_user if it needs an operator decision
  -> agent asks the user
  -> user answers in chat
  -> service receives the answer and triggers remediation if approved
```

Primitives used:

- Hosted service for monitoring webhook.
- Service data directory for alert dedupe and incident status.
- Shared SDK for diagnostics and operator decision.
- Agent chat for operator decision.

## Implementation Order

1. Add structured workflow results.
2. Add the shared `tc` SDK namespace for both workflows and hosted services.
3. Add blocking `tc.ask_user` handling with helper polling and DB-backed intermediate replies.
4. Add blocking `tc.call_workflow` handling with helper polling and DB-backed intermediate child results.
5. Add blocking `tc.run_agent` handling with helper polling and structured agent results.
6. Add workflow-only `tc.success` and `tc.fail`.
7. Add `answerWorkflowUserRequest` for agents to complete user requests.
8. Add user lookup tools for the agent.
9. Add `cronjob_todo_templates` and migrate encoded prompt todos into structured rows.
10. Add distinct role/role metadata for agent cronjob chat messages.
11. Add hosted service resource loading from `services/<slug>/service.json`.
12. Add creator-scoped runtime secret resolution: user secret first, then global secret.
13. Add service process manager with manual start, stop, restart, logs, approval checks, and secret injection.
14. Add reverse proxy routing for approved services.
15. Let the agent create service, workflow, and cronjob drafts.

## First Slice

The smallest useful slice is:

- Structured workflow results.
- Shared `tc` SDK.
- Blocking `tc.ask_user`.
- Blocking `tc.call_workflow`.
- Blocking `tc.run_agent`.
- Resource-owned data directories.

The next slice is:

- Hosted services with manual lifecycle and reverse proxy.
- Agent-authored draft services.

This keeps the first implementation focused while still leading to the full generic automation model.
