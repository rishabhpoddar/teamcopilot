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
- Workflow pauses and resume for deterministic code that needs user input.
- Approval-gated actions.
- Agent-mediated approval conversations.
- Agent-authored draft resources.

This avoids a large provider-specific monitor framework while still allowing WhatsApp bots, log monitors, GitHub bots, internal APIs, polling jobs, and approval workflows.

## What To Minimize

Do not introduce a generic event bus as a first version primitive.

For v1, services and cronjobs can directly call workflows or create approval actions. Durable state is enough for cursors, dedupe keys, thread ids, and resume state. If we later need fanout, subscriptions, replay, or cross-resource event routing, we can add an event log then.

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

Add a context file for richer inputs and resume:

```text
TEAMCOPILOT_CONTEXT_FILE=/tmp/teamcopilot-context.json
```

Example:

```json
{
  "mode": "initial",
  "input": {
    "from": "+15551234567",
    "message": "Can you check my order?"
  },
  "source": {
    "type": "service",
    "slug": "whatsapp-listener"
  }
}
```

Resume example for a workflow pause:

```json
{
  "mode": "resume",
  "input": {
    "from": "+15551234567",
    "message": "Can you check my order?"
  },
  "resume": {
    "pause_id": "pause_123",
    "state": {
      "step": "waiting_for_replacement_reply",
      "to": "+15551234567"
    },
    "user_input": "Tell them the order is delayed by one day."
  }
}
```

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
      status: "needs_user_input";
      question_to_user: string;
      resume_state: Record<string, unknown>;
    }
  | {
      status: "needs_approval";
      action: {
        type: string;
        payload: Record<string, unknown>;
      };
      resume_state?: Record<string, unknown>;
    };
```

Existing stdout/stderr logs should still be captured. The structured result is only for platform control flow.

Python helper:

```python
from teamcopilot import workflow

ctx = workflow.context()

workflow.success({"ok": True})
workflow.fail("Could not process request")
workflow.need_user_input(
    question="What should I reply with?",
    resume_state={"step": "waiting_for_reply"}
)
workflow.need_approval(
    action={
        "type": "send_whatsapp_message",
        "payload": {
            "to": "+15551234567",
            "message": "Your order arrives tomorrow."
        }
    },
    resume_state={"step": "waiting_for_send_approval"}
)
```

## Workflow Pauses

When a workflow returns `needs_user_input`, TeamCopilot stores a pause point and stops the workflow process.

This should only be used when deterministic workflow code must resume after the user answers. It is not required for normal approval chat. If an action is rejected and the agent can ask the user what to do next, the agent session should handle that continuation directly.

Suggested table:

```prisma
model workflow_pauses {
  id                  String @id @default(uuid())
  workflow_run_id      String
  workflow_slug        String
  status              String
  question_to_user     String
  resume_state_json    String
  session_id           String?
  opencode_session_id  String?
  created_at           BigInt
  resumed_at           BigInt?

  @@index([workflow_run_id])
  @@index([session_id, status])
  @@index([status])
}
```

Continuation:

```text
workflow returns needs_user_input
  -> TeamCopilot stores resume_state in workflow_pauses
  -> workflow process exits
  -> user replies later
  -> TeamCopilot starts a new workflow run with mode = resume
  -> workflow receives resume_state and user_input
```

This is durable and restart-safe.

## Actions

Actions are approval-gated side effects. The approval conversation should happen through an agent chat session by default.

Suggested table:

```prisma
model workflow_actions {
  id                    String @id @default(uuid())
  workflow_run_id        String?
  workflow_slug          String?
  type                  String
  status                String
  payload_json           String
  resume_state_json      String?
  session_id             String?
  opencode_session_id    String?
  created_at             BigInt
  responded_by_user_id   String?
  responded_at           BigInt?
  executed_at            BigInt?
  error_message          String?

  @@index([workflow_run_id])
  @@index([type])
  @@index([status])
}
```

Statuses:

```text
pending
approved
rejected
executed
failed
```

For v1, actions can be created only by workflow results. Hosted services that need approval should call a workflow, and the workflow can return `needs_approval`. That avoids creating a second action API too early.

Later, services can create actions directly if that becomes necessary.

Rejection behavior:

```text
action rejected
  -> TeamCopilot opens or reuses an agent chat session
  -> agent asks the user what should happen instead
  -> user replies
  -> agent may propose a new action or run another workflow
```

This does not require a workflow pause unless the original workflow needs to continue with the user's answer.

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
- Workflow result logic for `needs_approval` and `needs_user_input`.
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
- Workflow result logic for `needs_approval(send_slack_message)`.
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
- `needs_approval` actions must wait for user approval before execution.

## Use Cases

These examples are intentionally different from each other. The point is to verify that the primitive set is generic enough without introducing a dedicated platform abstraction for each domain.

1. WhatsApp reply approval

```text
hosted service receives WhatsApp webhook
  -> service verifies provider signature
  -> service dedupes message id with durable state
  -> service runs process-whatsapp-message workflow
  -> workflow drafts a reply
  -> workflow returns needs_approval(send_whatsapp_message)
  -> TeamCopilot opens or reuses an agent chat session for approval
  -> user approves or rejects in that chat
  -> approved action sends message
  -> rejected action routes back to the agent
  -> agent asks what to send instead
  -> user replies in chat
  -> agent proposes a new send_whatsapp_message action
```

Primitives used:

- Hosted service for webhook.
- Workflow for message processing.
- Durable state for dedupe and thread mapping.
- Workflow action for sending the reply.
- Agent chat for approval and replacement reply conversation.

2. Server log monitor

```text
cronjob runs every 5 minutes
  -> workflow reads last log offset from durable state
  -> workflow fetches new logs over SSH or HTTP
  -> workflow updates last offset
  -> workflow returns success if no issue
  -> workflow returns needs_approval(send_slack_message) if alert should be sent
```

Primitives used:

- Scheduled job for periodic checks.
- Workflow for log scanning.
- Durable state for cursor/offset.
- Workflow action for Slack alert.

3. GitHub PR review bot

```text
hosted service receives GitHub webhook
  -> service dedupes delivery id with durable state
  -> service runs review-pr workflow
  -> workflow checks changed files and runs tests
  -> workflow returns needs_approval(post_github_comment)
  -> user approves comment
  -> action posts review comment
```

Primitives used:

- Hosted service for GitHub webhook.
- Workflow for review logic.
- Durable state for delivery dedupe.
- Workflow action for posting comments.

4. Daily customer report

```text
cronjob runs every morning
  -> workflow queries database/API
  -> workflow generates report
  -> workflow returns needs_approval(send_email)
  -> user approves
  -> action emails report
```

Primitives used:

- Scheduled job for daily execution.
- Workflow for report generation.
- Workflow action for email.
- Durable state if the report needs last-run metadata.

5. Stripe payment failure handler

```text
hosted service receives Stripe webhook
  -> service dedupes event id with durable state
  -> service runs payment-failure workflow
  -> workflow checks customer context
  -> workflow either returns success or needs_approval(send_email)
  -> approved action sends customer follow-up
```

Primitives used:

- Hosted service for webhook.
- Workflow for business logic.
- Durable state for webhook dedupe.
- Workflow action for email or CRM update.

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
  -> workflow returns needs_approval(create_github_issue) for new drift
```

Primitives used:

- Scheduled job for hourly checks.
- Workflow for diffing schema.
- Durable state for suppressing duplicate alerts.
- Workflow action for creating an issue.

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
  -> workflow extracts data and returns needs_user_input if ambiguous
  -> user clarifies
  -> workflow resumes and produces final output
```

Primitives used:

- Hosted service for upload endpoint.
- Workflow for file processing.
- Durable state for upload metadata.
- Workflow pause for ambiguity resolution.

10. Incident responder

```text
hosted service receives monitoring webhook
  -> service dedupes alert fingerprint with durable state
  -> service runs incident-assessment workflow
  -> workflow checks logs, metrics, and recent deploys
  -> workflow returns needs_user_input if it needs an operator decision
  -> user answers in chat
  -> workflow resumes
  -> workflow returns needs_approval(run_remediation_workflow)
  -> approved action starts remediation
```

Primitives used:

- Hosted service for monitoring webhook.
- Workflow for assessment.
- Durable state for alert dedupe and incident status.
- Workflow pause for operator decision.
- Workflow action for gated remediation.

## Implementation Order

1. Add structured workflow results.
2. Add `TEAMCOPILOT_CONTEXT_FILE`.
3. Add `workflow_pauses` and resume mode.
4. Add `workflow_actions` and approval UI.
5. Add `automation_state`.
6. Add a minimal workflow helper library.
7. Add hosted service resource loading from `services/<slug>/service.json`.
8. Add service process manager with manual start, stop, restart, logs, approval checks, and secret injection.
9. Add reverse proxy routing for approved services.
10. Add minimal service helper API: `run_workflow`, `state.get`, `state.set`.
11. Let the agent create service, workflow, and cronjob drafts.

## First Slice

The smallest useful slice is:

- Structured workflow results.
- Workflow pauses and resume.
- Approval actions.
- Durable state.

The next slice is:

- Hosted services with manual lifecycle and reverse proxy.
- Minimal service API.
- Agent-authored draft services.

This keeps the first implementation focused while still leading to the full generic automation model.
