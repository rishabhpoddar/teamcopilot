# Generic Automation Primitives

## Goal

TeamCopilot should let users build complex automations by talking to the AI agent, without the platform needing a special first-class abstraction for every integration.

The platform should expose a small set of powerful primitives:

- Scheduled jobs: run something later or repeatedly.
- Hosted services: keep code running and reachable on an HTTP port.
- Workflow runs: run finite scripts to completion.
- Durable state: remember data across services, workflows, cron runs, restarts, and resumes.
- Platform events and actions: let primitives communicate with TeamCopilot, users, and each other.

Higher-level behavior such as WhatsApp monitors, log monitors, GitHub bots, internal webhooks, approval flows, and resumable workflows should be built out of these primitives.

## Design Principles

- Keep the platform primitives small, generic, and composable.
- Keep resources filesystem-first so the agent can create and modify them as normal files.
- Require approval before newly authored code can run automatically or receive external traffic.
- Inject secrets at runtime from declared contracts. Do not store secret values in resource files.
- Make long waits durable. Do not keep workflow processes alive while waiting for a human.
- Make side effects explicit through platform actions when approval or auditability matters.
- Reuse the existing workflow, cronjob, chat, approval, and secret systems where they fit.

## Primitive 1: Scheduled Jobs

Scheduled jobs already exist as cronjobs. Keep them as the primitive for repeated or delayed execution.

Purpose:

```text
Run code on a schedule.
```

Examples:

- Check server logs every 5 minutes.
- Poll an API every hour.
- Run a daily report.
- Reconcile stale workflow runs.

Scheduled jobs should be able to trigger:

- A workflow run.
- An agent prompt.
- An HTTP call to a hosted service.
- A platform event.

The existing cronjob implementation can remain the user-facing scheduled-job feature. Over time, its internals can be simplified around the same platform event/action protocol described below.

## Primitive 2: Hosted Services

Hosted services are long-running processes managed by TeamCopilot.

Purpose:

```text
Keep user-authored code running and optionally expose it through TeamCopilot HTTP routing.
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
  "entrypoint": "server.py",
  "runtime": "python",
  "port": 7001,
  "http": {
    "public_path": "/services/whatsapp-listener"
  },
  "required_secrets": ["WHATSAPP_WEBHOOK_SECRET", "WHATSAPP_ACCESS_TOKEN"],
  "healthcheck": {
    "path": "/health",
    "interval_seconds": 30
  }
}
```

TeamCopilot responsibilities:

- Allocate or validate a port.
- Start, stop, and restart the service.
- Inject declared secrets.
- Capture logs.
- Run healthchecks.
- Reverse-proxy public paths to the local service.
- Enforce approval before a service can start or receive external traffic.
- Stop services when code changes invalidate approval.

This unlocks:

- Webhook receivers.
- Provider callback handlers.
- Small internal APIs.
- Long-running sync processes.
- Custom protocol adapters.

## Primitive 3: Workflow Runs

Workflow runs already exist and should remain the primitive for finite code execution.

Purpose:

```text
Run code now, finish, and return a structured result.
```

Examples:

- Process one incoming WhatsApp message.
- Scan logs and classify errors.
- Generate a report.
- Send a Slack message.
- Transform files in the workspace.

Workflow runs should support a platform context file:

```text
TEAMCOPILOT_CONTEXT_FILE=/tmp/teamcopilot-context-abc.json
```

Example initial context:

```json
{
  "mode": "initial",
  "input": {
    "message": "Can you check my order?",
    "from": "+15551234567"
  },
  "source": {
    "type": "service",
    "slug": "whatsapp-listener",
    "event_id": "evt_123"
  }
}
```

Example resume context:

```json
{
  "mode": "resume",
  "input": {
    "message": "Can you check my order?",
    "from": "+15551234567"
  },
  "resume": {
    "wait_id": "wait_123",
    "state": {
      "step": "waiting_for_replacement_reply",
      "to": "+15551234567",
      "draft_reply": "Your order arrives tomorrow."
    },
    "user_input": "Tell them the order is delayed by one day."
  }
}
```

## Primitive 4: Durable State

Durable state is a small namespaced key-value store available to hosted services, workflows, cronjobs, and platform tools.

Purpose:

```text
Remember data between runs and across restarts.
```

Examples:

- Last log offset.
- Last seen provider event id.
- OAuth cursor.
- Thread mapping.
- Dedupe key.
- Workflow resume state.
- Service-local configuration.

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

Suggested helper API:

```text
state.get(namespace, key)
state.set(namespace, key, value)
state.delete(namespace, key)
state.list(namespace, prefix)
```

Namespaces should map to resources:

```text
service:whatsapp-listener
workflow:process-whatsapp-message
cronjob:prod-log-check
session:<chat-session-id>
```

The state store should be available through a platform helper library and internal authenticated APIs.

## Primitive 5: Platform Events And Actions

Events and actions are the communication protocol between primitives.

Events describe something that happened:

```json
{
  "type": "whatsapp.message.received",
  "source": "service:whatsapp-listener",
  "correlation_id": "whatsapp:+15551234567:wamid.123",
  "payload": {
    "from": "+15551234567",
    "text": "Can you check my order?",
    "message_id": "wamid.123"
  }
}
```

Actions request that TeamCopilot do something:

```json
{
  "type": "send_whatsapp_message",
  "approval": "required",
  "payload": {
    "to": "+15551234567",
    "message": "Your order arrives tomorrow."
  }
}
```

Suggested tables:

```prisma
model automation_events {
  id             String @id @default(uuid())
  type           String
  source         String
  correlation_id String?
  payload_json   String
  status         String
  created_at     BigInt
  completed_at   BigInt?
  error_message  String?

  @@index([type])
  @@index([source])
  @@index([correlation_id])
  @@index([status])
}

model automation_actions {
  id                    String @id @default(uuid())
  type                  String
  source                String
  status                String
  approval              String
  payload_json          String
  resume_state_json     String?
  session_id            String?
  opencode_session_id   String?
  created_at            BigInt
  responded_by_user_id  String?
  responded_at          BigInt?
  executed_at           BigInt?
  error_message         String?

  @@index([type])
  @@index([source])
  @@index([status])
}
```

Suggested event statuses:

- `queued`
- `processing`
- `success`
- `failed`
- `waiting_for_user`
- `waiting_for_approval`

Suggested action statuses:

- `pending`
- `approved`
- `rejected`
- `executed`
- `failed`

## Workflow Result Protocol

All workflows should be able to return structured results.

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
      prompt_to_ai?: string;
      resume_state: Record<string, unknown>;
    }
  | {
      status: "needs_approval";
      action: {
        type: string;
        payload: Record<string, unknown>;
      };
      resume_state: Record<string, unknown>;
    };
```

Existing stdout/stderr logs should still be captured, but workflow control should use this structured result.

Provide a small helper package for workflow authors:

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

## Waits And Resume

When a workflow needs a user, TeamCopilot stores a durable wait and stops the workflow process.

Suggested table:

```prisma
model automation_waits {
  id                  String @id @default(uuid())
  source              String
  workflow_run_id      String?
  workflow_slug        String?
  session_id           String?
  opencode_session_id  String?
  status              String
  question_to_user     String
  prompt_to_ai         String?
  resume_state_json    String
  created_at           BigInt
  resumed_at           BigInt?

  @@index([source])
  @@index([session_id, status])
  @@index([status])
}
```

Continuation is:

```text
workflow returns needs_user_input
  -> TeamCopilot stores resume_state
  -> workflow process exits
  -> user replies later
  -> TeamCopilot starts a new workflow run in resume mode
  -> workflow receives resume_state and user_input
```

This makes pauses restart-safe and independent of process lifetime.

## Hosted Service Protocol

Hosted services need a small internal API or helper library to call back into TeamCopilot.

Minimum capabilities:

```text
emit_event(type, payload, correlation_id=None)
run_workflow(slug, input)
create_action(type, payload, approval)
get_state(key)
set_state(key, value)
append_log(message)
```

For Python services:

```python
from teamcopilot import service

app = service.create_app()

@app.post("/webhook")
def webhook(request):
    event = parse_provider_payload(request)
    service.emit_event(
        "whatsapp.message.received",
        event,
        correlation_id=f"whatsapp:{event['from']}:{event['message_id']}",
    )
    service.run_workflow("process-whatsapp-message", event)
    return {"ok": True}
```

The helper should use an internal service token injected by TeamCopilot. Users should not manage that token manually.

## Agent-Authored Automation

The AI agent should create automations by composing the primitives.

Example request:

```text
When I get a new WhatsApp message, process it. If you think I need to approve the reply, message me first.
```

The agent can create:

- `services/whatsapp-listener/` to receive the webhook.
- `workflows/process-whatsapp-message/` to process each message.
- Required secret declarations for WhatsApp.
- Structured workflow outputs for approval and resume.
- Durable state keys for dedupe and conversation mapping.

Example request:

```text
Check the logs in my server periodically. If there is this type of error, send me a Slack message.
```

The agent can create:

- A cronjob that runs every few minutes.
- A workflow that connects to the server and scans logs.
- Durable state for the last log offset.
- An action request for `send_slack_message`.
- Required secret declarations for SSH and Slack.

Agent-authored resources should start as drafts. They become active only after validation, secret checks, and approval.

## Approval And Safety

Use the existing resource approval snapshot model for new resource kinds:

```text
resource_kind = "service"
resource_kind = "workflow"
resource_kind = "cronjob"
```

Before automatic execution:

- Hosted service code must be approved before it can start or receive traffic.
- Workflow code must be approved before it can run from cronjobs or services.
- Cronjob definitions must be approved before they can run unattended.
- Required secrets must be present.
- External actions with `approval = "required"` must wait for user approval.

Hosted services need stricter controls:

- Port allocation and reverse proxy ownership.
- Process lifecycle management.
- Log capture.
- Healthchecks.
- Restart policy.
- Code-change invalidation.
- Secret injection.
- Optional resource limits.

## Examples

WhatsApp monitor:

```text
hosted service receives Meta webhook
  -> emits whatsapp.message.received
  -> runs process-whatsapp-message workflow
  -> workflow returns needs_approval(send_whatsapp_message)
  -> user approves or rejects
  -> approved action sends WhatsApp reply
  -> rejected action creates wait
  -> user replies in chat
  -> workflow resumes with resume_state and user_input
```

Server log monitor:

```text
cronjob runs every 5 minutes
  -> workflow reads last offset from durable state
  -> workflow checks server logs
  -> workflow updates last offset
  -> workflow returns success if nothing matters
  -> workflow returns needs_approval(send_slack_message) if alert should be sent
```

GitHub bot:

```text
hosted service receives GitHub webhook
  -> emits github.pull_request.opened
  -> runs review workflow or starts agent session
  -> workflow proposes comment action
  -> user approval controls whether comment is posted
```

## Implementation Phases

1. Add `automation_state`, `automation_events`, `automation_actions`, and `automation_waits` schema.
2. Add workflow structured result parsing while preserving existing stdout/stderr logs.
3. Add `TEAMCOPILOT_CONTEXT_FILE` support to the workflow runner.
4. Add workflow resume mode from `automation_waits`.
5. Add action approval APIs and UI.
6. Add a minimal platform helper library for workflows.
7. Add hosted service resource loading from `services/<slug>/service.json`.
8. Add service process manager with start, stop, restart, logs, healthcheck, and approval checks.
9. Add reverse proxy routing for approved hosted services.
10. Add internal service API/helper token for state, events, actions, and workflow runs.
11. Extend cronjobs so scheduled jobs can emit events or call workflows with context.
12. Add agent-facing tools to create service, workflow, and cronjob drafts.
13. Add validation commands that report missing secrets, approval state, ports, and manifest errors.
14. Add examples/templates for WhatsApp webhook and server log monitoring.

## Non-Goals For First Version

- A large provider-specific monitor framework.
- A visual workflow builder.
- Full container isolation.
- Migrating existing cronjobs into a new data model.
- Supporting every outbound action type upfront.

## First Slice

The smallest useful version is:

- Structured workflow results.
- Durable waits and resume.
- Generic actions with approval.
- Hosted services with manual start/stop and logs.
- Reverse proxy for approved hosted services.
- Agent-created draft resources.

With that slice, WhatsApp and log monitoring become compositions of the primitives rather than new platform categories.
