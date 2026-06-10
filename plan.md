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
- Agent-mediated user conversations with rerun args.
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
- Prompt an agent.
- Call a hosted service.

We should reuse the existing cronjob system rather than building a new scheduler.

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

Workflows keep using args the same way they do today. If a workflow needs the user, it returns `ask_user` with a plain-English instruction that tells the agent what to ask and how to rerun the workflow with updated args.

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

All workflows should be able to return one of these structured results:

```ts
type WorkflowResult =
  | {
      status: "success";
      output?: unknown;
    }
  | {
      status: "failed";
      error: string;
    }
  | {
      status: "ask_user";
      instruction_to_agent: string;
    };
```

Existing stdout/stderr logs should still be captured. The structured result is only for platform control flow.

Python helper:

```python
from teamcopilot import workflow

ctx = workflow.context()

workflow.ask_user("""
Ask the user what reply should be sent.
After they answer, rerun this workflow with:
{
  "from": "+15551234567",
  "message": "Can you check my order?",
  "replacement_reply": "<user answer>"
}
""")
workflow.success({"ok": True})
workflow.fail("Could not process request")
```

## Ask User

When a workflow returns `ask_user`, TeamCopilot stores the instruction, opens or reuses an agent chat session, and stops the workflow process.

The workflow does not need to manage pause state itself. The workflow should encode everything the agent needs to know in `instruction_to_agent`, including:

- The question the agent should ask the user.
- The exact rerun args to use after the user answers.
- Any context the agent needs to continue correctly.
- Any branch-specific instructions for the user reply.

Suggested run status:

```text
paused
```

Continuation:

```text
workflow returns ask_user
  -> TeamCopilot stores the instruction on the workflow run
  -> agent asks the user the question from the instruction
  -> user replies in the agent chat
  -> agent reruns the workflow with the args specified in the instruction
```

This is durable and restart-safe.

## Hosted Service API

Hosted services need only a small internal API for v1:

```text
run_workflow(slug, input)
state.get(key)
state.set(key, value)
```

Optional later:

```text
create_action(type, payload)
append_log(message)
emit_event(type, payload)
```

Start with the minimal API. A webhook service can receive a request, dedupe with state, and run a workflow.

Example:

```python
from teamcopilot import service

app = service.create_app()

@app.post("/webhook")
def webhook(request):
    event = parse_provider_payload(request)
    dedupe_key = f"message:{event['message_id']}"
    if service.state.get(dedupe_key):
        return {"ok": True}

    service.state.set(dedupe_key, True)
    service.run_workflow("process-whatsapp-message", event)
    return {"ok": True}
```

## Agent-Authored Automation

The AI agent composes these primitives.

For:

```text
When I get a new WhatsApp message, process it. If approval is needed, message me first.
```

The agent creates:

- `services/whatsapp-listener/` for the webhook.
- `workflows/process-whatsapp-message/` for processing.
- Workflow logic that returns `ask_user` with rerun args when the user needs to be involved.
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
- Workflow logic that returns `ask_user` with rerun args when the alert needs user confirmation.
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
- Workflows can only ask the user through `ask_user`; the agent handles the conversation and rerun.

## Use Cases

These examples are intentionally different from each other. The point is to verify that the primitive set is generic enough without introducing a dedicated platform abstraction for each domain.

1. WhatsApp reply approval

```text
hosted service receives WhatsApp webhook
  -> service verifies provider signature
  -> service dedupes message id with durable state
  -> service runs process-whatsapp-message workflow
  -> workflow drafts a reply
  -> workflow returns ask_user with instructions for the agent
  -> TeamCopilot opens or reuses an agent chat session
  -> agent asks the user what should happen next
  -> user replies in chat
  -> agent reruns the workflow with the args from the instruction
```

Primitives used:

- Hosted service for webhook.
- Workflow for message processing.
- Durable state for dedupe and thread mapping.
- Agent chat for user interaction and rerun.

2. Server log monitor

```text
cronjob runs every 5 minutes
  -> workflow reads last log offset from durable state
  -> workflow fetches new logs over SSH or HTTP
  -> workflow updates last offset
  -> workflow returns success if no issue
  -> workflow returns ask_user if the agent should confirm an alert or ask for a next step
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
  -> workflow returns ask_user with instructions for the review conversation
  -> user replies in the agent chat
  -> agent reruns the workflow or posts the comment as instructed
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
  -> workflow returns ask_user if the agent should confirm the report or ask where to send it
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
  -> workflow either returns success or ask_user with instructions for the follow-up conversation
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
  -> workflow returns ask_user if the agent should confirm creating an issue
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
  -> workflow extracts data and returns ask_user if ambiguous
  -> agent asks the user for clarification
  -> user replies
  -> agent reruns the workflow with the clarified args
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
  -> workflow returns ask_user if it needs an operator decision
  -> agent asks the user
  -> user answers in chat
  -> agent reruns the workflow or triggers the next step
```

Primitives used:

- Hosted service for monitoring webhook.
- Workflow for assessment.
- Durable state for alert dedupe and incident status.
- Agent chat for operator decision.

## Implementation Order

1. Add structured workflow results.
2. Add `ask_user` handling and agent rerun flow.
3. Add `automation_state`.
4. Add a minimal workflow helper library with `ask_user`, `success`, and `fail`.
5. Add hosted service resource loading from `services/<slug>/service.json`.
6. Add service process manager with manual start, stop, restart, logs, approval checks, and secret injection.
7. Add reverse proxy routing for approved services.
8. Add minimal service helper API: `run_workflow`, `state.get`, `state.set`.
9. Let the agent create service, workflow, and cronjob drafts.

## First Slice

The smallest useful slice is:

- Structured workflow results.
- `ask_user` and agent rerun flow.
- Durable state.

The next slice is:

- Hosted services with manual lifecycle and reverse proxy.
- Minimal service API.
- Agent-authored draft services.

This keeps the first implementation focused while still leading to the full generic automation model.
