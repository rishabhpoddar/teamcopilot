# Minimal Automation Primitives

## Goal

TeamCopilot should let users build complex automations by talking to the AI agent, while keeping the platform primitives small enough to stay understandable.

The minimal foundation is:

- Scheduled jobs: run something later or repeatedly.
- Hosted services: keep code running and optionally expose HTTP endpoints.
- Workflow runs: run finite scripts to completion.
- Durable state: remember data across runs, services, restarts, and resumes.

Everything else should be a protocol on top of those primitives:

- Structured workflow results.
- Blocking workflow helper calls for agent-mediated user conversations.
- Blocking workflow helper calls for workflow-to-workflow composition.
- Agent-authored draft resources.

This avoids a large provider-specific monitor framework while still allowing WhatsApp bots, log monitors, GitHub bots, internal APIs, polling jobs, and approval workflows.

## What To Minimize

Do not introduce a generic event bus as a first version primitive.

For v1, services and cronjobs can directly call workflows. Durable state is enough for cursors, dedupe keys, thread ids, and other bookkeeping. If we later need fanout, subscriptions, replay, or cross-resource event routing, we can add an event log then.

Do not introduce provider-specific abstractions like `whatsapp_monitor`, `slack_monitor`, or `event_handler`.

The agent should build those as compositions of services, cronjobs, workflows, and state.

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

- Run a workflow.
- Run an agent session with the existing todo-driven cronjob loop.
- Call a hosted service.

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

- Process one WhatsApp message.
- Scan logs and decide whether to alert.
- Generate a report.
- Send a Slack message.

Workflows keep using args the same way they do today. If a workflow needs the user, it calls `ask_user(instruction_to_agent, user_id)` and blocks until the user replies. If a workflow needs another workflow, it calls `call_workflow(slug, args)` and blocks until that workflow finishes.

This version does not add a separate workflow state file, file-path argument, or continuation args. The Python process keeps its local call stack while helper calls wait.

## Workflow Composition

A workflow should be able to call another workflow and consume its terminal result while preserving local Python context.

Minimal helper:

```python
result = workflow.call_workflow("child-workflow-slug", {
    "customer_id": "123",
    "order_id": "456"
})
```

Behavior:

- The current workflow process stays alive.
- TeamCopilot starts the child workflow with the provided args.
- If the child workflow returns `ask_user`, TeamCopilot handles that interaction and continues the child until it reaches a terminal state.
- The parent workflow helper polls TeamCopilot until the child reaches a terminal state.
- The helper returns the child result to the parent workflow.
- TeamCopilot stores the intermediate child result in the DB while the parent is waiting.
- TeamCopilot clears the intermediate child result after the parent workflow finishes.

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

Parent workflow shape:

```python
result = workflow.call_workflow("child-workflow-slug", {"message": text})

if result["status"] == "success":
    label = result["output"]["label"]
    ...
else:
    workflow.fail(result["error"])
```

This keeps workflow code natural. Loops, local variables, and exception handling stay intact because the parent process is not restarted.

Intermediate child workflow results are runtime bookkeeping, not durable workflow output. They should be deleted after the parent workflow reaches `success` or `failed`.

## Primitive 4: Durable State

Durable state is a generic namespaced key-value store.

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

Suggested table:

```prisma
model automation_state {
  namespace  String
  key        String
  value_json String
  created_at BigInt
  updated_at BigInt

  @@id([namespace, key])
  @@index([namespace])
}
```

API:

```text
state.get(key)
state.set(key, value)
state.delete(key)
state.list(prefix)
```

The namespace should be implicit from the caller, for example `service:whatsapp-listener` or `workflow:process-message`. That keeps scripts simple and avoids making users pass namespace strings everywhere.

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
from teamcopilot import workflow

ctx = workflow.context()

reply = workflow.ask_user("""
Ask the user what reply should be sent.
""", user_id="user_123")

child_result = workflow.call_workflow("classify-message", {
    "message": reply
})

workflow.success({"ok": True})
workflow.fail("Could not process request")
```

## Ask User

When a workflow calls `ask_user`, TeamCopilot stores the instruction in the DB, opens or reuses an agent chat session for the specified user, and the workflow helper polls until the user replies.

The workflow should encode everything the agent needs to know in `instruction_to_agent`, including:

- The question the agent should ask the user.
- The user id of the person the agent should ask.
- Any context the agent needs to continue correctly.
- Any branch-specific instructions for the user reply.

Suggested parent run status while blocked:

```text
waiting_for_user
```

Behavior:

```text
workflow calls ask_user
  -> TeamCopilot stores the instruction in the DB
  -> agent asks the user identified by the instruction
  -> user replies in the agent chat
  -> TeamCopilot stores the reply in the DB
  -> workflow helper polling sees the reply
  -> workflow helper returns the reply string to the script
  -> workflow script continues from the same stack frame
  -> TeamCopilot clears the intermediate reply after the workflow finishes
```

This preserves local Python state. It is less restart-durable than the previous state-machine design, but it is much simpler for workflow authors.

Intermediate user replies are runtime bookkeeping, not durable workflow output. They should be deleted after the workflow reaches `success` or `failed`.

## Hosted Service API

Hosted services need only a small internal API for v1:

```text
service.call_workflow(slug, args) -> result
service.ask_user(instruction_to_agent, user_id) -> user_reply
```

This mirrors the workflow orchestration API, except hosted services do not have `success` or `fail` because they are long-lived processes rather than finite workflow runs.

Start with the minimal API. A webhook service can receive a request, call a workflow, ask a user when needed, and return an HTTP response.

Example:

```python
from teamcopilot import service

app = service.create_app()

@app.post("/webhook")
def webhook(request):
    event = parse_provider_payload(request)
    result = service.call_workflow("process-whatsapp-message", event)
    if result["status"] == "failed":
        return {"ok": False, "error": result["error"]}, 500
    return {"ok": True}
```

## Agent-Authored Automation

The AI agent composes these primitives.

It also needs a user lookup tool so it can resolve the `user_id` before writing a workflow that calls `ask_user`.

Minimum agent-facing user tools:

- `list_users`: list users in TeamCopilot with id, name, email, and role.
- `find_user`: search users by name or email and return matching ids.

For:

```text
When I get a new WhatsApp message, process it. If approval is needed, message me first.
```

The agent creates:

- `services/whatsapp-listener/` for the webhook.
- `workflows/process-whatsapp-message/` for processing.
- Workflow logic that calls `ask_user` when the user needs to be involved.
- Workflow logic that includes the target `user_id` in `ask_user`.
- State usage for dedupe and external thread mapping.
- Required secret declarations.

For:

```text
Check the logs in my server periodically. If this error appears, send me a Slack message.
```

The agent creates:

- A cronjob.
- A workflow that scans logs.
- State usage for last log offset.
- Workflow logic that calls `ask_user` when the alert needs user confirmation.
- Workflow logic that includes the target `user_id` in `ask_user`.
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
- Workflows can only ask the user through `ask_user`; the agent handles the conversation and returns the reply to the blocked workflow helper.

## Use Cases

These examples are intentionally different from each other. The point is to verify that the primitive set is generic enough without introducing a dedicated platform abstraction for each domain.

1. WhatsApp reply approval

```text
hosted service receives WhatsApp webhook
  -> service verifies provider signature
  -> service dedupes message id with durable state
  -> service runs process-whatsapp-message workflow
  -> workflow drafts a reply
  -> workflow calls ask_user with instructions for the agent
  -> TeamCopilot opens or reuses an agent chat session
  -> agent asks the user what should happen next
  -> user replies in chat
  -> workflow receives the reply and continues
```

Primitives used:

- Hosted service for webhook.
- Workflow for message processing.
- Durable state for dedupe and thread mapping.
- Agent chat for user interaction.

2. Server log monitor

```text
cronjob runs every 5 minutes
  -> workflow reads last log offset from durable state
  -> workflow fetches new logs over SSH or HTTP
  -> workflow updates last offset
  -> workflow returns success if no issue
  -> workflow calls ask_user if the agent should confirm an alert or ask for a next step
```

Primitives used:

- Scheduled job for periodic checks.
- Workflow for log scanning.
- Durable state for cursor/offset.
- Agent chat for alert confirmation.

3. GitHub PR review bot

```text
hosted service receives GitHub webhook
  -> service dedupes delivery id with durable state
  -> service runs review-pr workflow
  -> workflow checks changed files and runs tests
  -> workflow calls ask_user with instructions for the review conversation
  -> user replies in the agent chat
  -> workflow receives the reply and continues
```

Primitives used:

- Hosted service for GitHub webhook.
- Workflow for review logic.
- Durable state for delivery dedupe.
- Agent chat for review confirmation.

4. Daily customer report

```text
cronjob runs every morning
  -> workflow queries database/API
  -> workflow generates report
  -> workflow calls ask_user if the agent should confirm the report or ask where to send it
```

Primitives used:

- Scheduled job for daily execution.
- Workflow for report generation.
- Agent chat for report delivery confirmation.
- Durable state if the report needs last-run metadata.

5. Stripe payment failure handler

```text
hosted service receives Stripe webhook
  -> service dedupes event id with durable state
  -> service runs payment-failure workflow
  -> workflow checks customer context
  -> workflow either returns success or calls ask_user with instructions for the follow-up conversation
```

Primitives used:

- Hosted service for webhook.
- Workflow for business logic.
- Durable state for webhook dedupe.
- Agent chat for the follow-up decision.

6. Internal support triage API

```text
hosted service exposes /triage
  -> internal tool posts support ticket text
  -> service runs triage-ticket workflow
  -> workflow classifies urgency and owner
  -> workflow returns success with structured output
  -> service responds to caller with classification
```

Primitives used:

- Hosted service for HTTP API.
- Workflow for finite classification work.
- Durable state if prior ticket context is needed.

No new monitor abstraction is required because this is just a small hosted API plus workflow execution.

7. Database drift checker

```text
cronjob runs hourly
  -> workflow introspects database schema
  -> workflow compares against expected schema in repo
  -> workflow stores last seen drift hash in state
  -> workflow returns success if unchanged
  -> workflow calls ask_user if the agent should confirm creating an issue
```

Primitives used:

- Scheduled job for hourly checks.
- Workflow for diffing schema.
- Durable state for suppressing duplicate alerts.
- Agent chat for issue confirmation.

8. OAuth callback and token refresher

```text
hosted service receives OAuth callback
  -> service stores non-secret account metadata in durable state
  -> service uses platform secrets for tokens
  -> cronjob periodically runs refresh-token workflow
  -> workflow refreshes token and updates stored metadata
```

Primitives used:

- Hosted service for callback.
- Durable state for account/cursor metadata.
- Scheduled job for refresh.
- Workflow for token refresh logic.

Secret values should still live in TeamCopilot secrets, not durable state.

9. File drop processor

```text
hosted service exposes upload endpoint
  -> user/system uploads a file
  -> service writes file into workspace or managed storage
  -> service runs process-upload workflow
  -> workflow extracts data and calls ask_user if ambiguous
  -> agent asks the user for clarification
  -> user replies
  -> workflow receives the clarification and continues
```

Primitives used:

- Hosted service for upload endpoint.
- Workflow for file processing.
- Durable state for upload metadata.
- Agent chat for ambiguity resolution.

10. Incident responder

```text
hosted service receives monitoring webhook
  -> service dedupes alert fingerprint with durable state
  -> service runs incident-assessment workflow
  -> workflow checks logs, metrics, and recent deploys
  -> workflow calls ask_user if it needs an operator decision
  -> agent asks the user
  -> user answers in chat
  -> workflow receives the answer and continues
```

Primitives used:

- Hosted service for monitoring webhook.
- Workflow for assessment.
- Durable state for alert dedupe and incident status.
- Agent chat for operator decision.

## Implementation Order

1. Add structured workflow results.
2. Add blocking `ask_user` handling with helper polling and DB-backed intermediate replies.
3. Add `automation_state`.
4. Add blocking `call_workflow` handling with helper polling and DB-backed intermediate child results.
5. Add a minimal workflow helper library with `call_workflow`, `ask_user`, `success`, and `fail`.
6. Add user lookup tools for the agent.
7. Add `cronjob_todo_templates` and migrate encoded prompt todos into structured rows.
8. Add distinct role/role metadata for agent cronjob chat messages.
9. Add hosted service resource loading from `services/<slug>/service.json`.
10. Add service process manager with manual start, stop, restart, logs, approval checks, and secret injection.
11. Add reverse proxy routing for approved services.
12. Add minimal service helper API: `call_workflow` and `ask_user`.
13. Let the agent create service, workflow, and cronjob drafts.

## First Slice

The smallest useful slice is:

- Structured workflow results.
- Blocking `ask_user`.
- Blocking `call_workflow`.
- Durable state.

The next slice is:

- Hosted services with manual lifecycle and reverse proxy.
- Minimal service API.
- Agent-authored draft services.

This keeps the first implementation focused while still leading to the full generic automation model.
