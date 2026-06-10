# Event Ingress, External Actions, and Resumable Workflows

## Goal

Introduce a clean way for TeamCopilot to receive external events, process them with static code, workflows, or AI agents, and perform external side effects such as sending WhatsApp replies with user approval when needed.

Primary use cases:

- Receive incoming WhatsApp messages.
- Process events with normal code, workflows, or AI.
- Ask a TeamCopilot user for approval before risky outbound actions.
- Ask the user for replacement input when an action is rejected.
- Continue the original automation from persisted state after the user replies.
- Avoid creating a new visible user-agent chat session for every inbound event.

## Design Principles

- TeamCopilot owns the HTTP ingress surface. Do not start with arbitrary user-hosted servers.
- External events are persisted before processing.
- Workflows and agents are execution targets, not webhook endpoints themselves.
- External side effects go through explicit pending action records.
- User-facing chat sessions are created or revealed only when needed.
- Workflow continuation is durable and restart-safe. Do not keep workflow processes alive while waiting for a user.
- Filesystem-first resources remain the source of truth for handler definitions.
- Secrets are declared and resolved by the platform, not embedded in workflow or handler files.

## High-Level Architecture

```text
External event
  -> TeamCopilot managed ingress endpoint
  -> verify auth/signature
  -> normalize and persist event delivery
  -> dispatch to event handler target
      -> static handler
      -> workflow run
      -> AI agent processing
  -> optional pending external action
  -> optional user approval or user input
  -> continuation from persisted state
  -> external action execution
```

## Resource Model

Add a new filesystem resource type:

```text
event-handlers/
  whatsapp-inbound/
    handler.json
    run.py
    README.md
```

Example `handler.json`:

```json
{
  "name": "WhatsApp Inbound",
  "trigger": {
    "type": "webhook",
    "path": "whatsapp/inbound",
    "auth": {
      "type": "hmac",
      "secret": "WHATSAPP_WEBHOOK_SECRET"
    }
  },
  "target": {
    "type": "workflow",
    "workflow_slug": "process-whatsapp-message"
  },
  "handoff": {
    "create_session": "when_needed",
    "approval_required_for": ["send_whatsapp_message"],
    "auto_visible_on": ["rejected_action", "agent_question", "failed_processing"]
  },
  "required_secrets": ["WHATSAPP_ACCESS_TOKEN"],
  "dedupe_key": "{{provider}}:{{message_id}}"
}
```

Supported target types:

- `workflow`: run an existing workflow with normalized event input.
- `agent`: process with a persistent hidden agent session for the external thread.
- `static`: run handler-local code for deterministic processing.
- `hybrid`: static code normalizes/routes, then starts a workflow or agent.

## Managed Webhook Ingress

Add a backend route:

```text
POST /api/ingress/webhooks/:handlerSlug
```

Responsibilities:

- Load and validate `event-handlers/<slug>/handler.json`.
- Verify webhook auth or provider signature.
- Normalize the provider payload into a TeamCopilot event shape.
- Find or create the external thread.
- Create an event delivery row.
- Return quickly to the provider.
- Dispatch processing asynchronously.

The webhook request should not block on full processing. It should only verify, persist, enqueue, and return.

## Persistent External Threads

External conversations should be tracked separately from TeamCopilot chat sessions.

For WhatsApp, an external thread is usually one phone number or provider conversation id.

```prisma
model external_threads {
  id                  String @id @default(uuid())
  provider            String
  external_thread_id  String
  assigned_user_id    String?
  session_id          String?
  opencode_session_id String?
  created_at          BigInt
  updated_at          BigInt

  @@unique([provider, external_thread_id])
}
```

Rules:

- One `external_threads` row per external conversation.
- At most one linked TeamCopilot chat session per external thread.
- Inbound messages do not automatically create visible TeamCopilot sessions.
- A hidden session may be created for agent memory.
- The session becomes visible only when human input, approval, rejection handling, or failure escalation is needed.

## Event Deliveries

Each inbound or outbound provider event gets a durable record.

```prisma
model event_deliveries {
  id                  String @id @default(uuid())
  thread_id            String
  handler_slug         String
  provider             String
  provider_event_id    String?
  direction            String
  payload_json         String
  normalized_json      String?
  status              String
  processing_run_id    String?
  workflow_run_id      String?
  session_id           String?
  opencode_session_id  String?
  error_message        String?
  received_at          BigInt
  completed_at         BigInt?

  @@unique([handler_slug, provider_event_id])
  @@index([thread_id, received_at])
  @@index([status])
}
```

Suggested statuses:

- `received`
- `processing`
- `success`
- `failed`
- `waiting_for_user`
- `waiting_for_approval`

## Processing Runs

An event delivery may create a processing run.

```prisma
model processing_runs {
  id                  String @id @default(uuid())
  thread_id            String
  delivery_id          String
  handler_slug         String
  workflow_slug        String?
  mode                String
  status              String
  session_id           String?
  opencode_session_id  String?
  started_at           BigInt
  completed_at         BigInt?
  error_message        String?
}
```

Suggested modes:

- `static`
- `workflow`
- `agent`

Suggested statuses:

- `running`
- `success`
- `failed`
- `waiting_for_user`
- `waiting_for_approval`

## Persistent Hidden Agent Sessions

For agent-based processing, prefer one persistent hidden OpenCode session per external thread.

```text
WhatsApp contact +15551234567
  -> external_thread row
  -> one hidden chat_session/opencode_session
  -> all inbound messages are appended to that same session
  -> session becomes visible only when needed
```

This avoids creating a new visible user-agent chat for every WhatsApp message while preserving conversation context.

When escalation is needed:

```text
if external_thread.session_id exists:
  reuse it
else:
  create hidden TeamCopilot chat session
  save session_id and opencode_session_id on external_threads

if user input is needed:
  set chat_sessions.visible_to_user = true
```

## External Actions

The AI or workflow should not directly perform risky external side effects. It should propose an external action.

Example action:

```json
{
  "action_type": "send_whatsapp_message",
  "payload": {
    "to": "+15551234567",
    "message": "Your order is expected to arrive tomorrow by 6 PM."
  }
}
```

Add a generic pending action table:

```prisma
model pending_external_actions {
  id                    String @id @default(uuid())
  delivery_id            String?
  processing_run_id      String?
  session_id             String?
  opencode_session_id    String?
  action_type            String
  status                String
  title                 String
  payload_json           String
  resume_state_json      String?
  created_by            String
  created_at            BigInt
  responded_by_user_id   String?
  responded_at          BigInt?
  executed_at           BigInt?
  error_message         String?
}
```

Suggested statuses:

- `pending`
- `approved`
- `rejected`
- `executed`
- `failed`

For the first implementation, support one action type:

```text
send_whatsapp_message
```

Later this can generalize to:

- `send_email`
- `post_slack_message`
- `create_github_issue`
- `update_database_record`
- `run_workflow`

## Approval Flow

When a workflow or agent proposes a WhatsApp reply:

```text
create pending_external_action
mark processing_run waiting_for_approval
mark event_delivery waiting_for_approval
notify or reveal assigned user
```

Approve path:

```text
POST /api/external-actions/:id/approve
```

Backend should:

- Mark the action as `approved`.
- Execute it server-side using resolved secrets.
- Send the WhatsApp message through the provider API.
- Mark the action as `executed`.
- Mark processing run and event delivery as `success` if no further work is needed.
- Append a system note to the linked agent session if one exists.

Reject path:

```text
POST /api/external-actions/:id/reject
```

Backend should:

- Mark the action as `rejected`.
- Create a workflow or automation wait for replacement user input.
- Reveal the linked TeamCopilot session.
- Ask the user what to send instead.

## User Input Waits

When processing needs human input, create a durable wait record.

```prisma
model workflow_waits {
  id                  String @id @default(uuid())
  processing_run_id    String?
  workflow_run_id      String?
  workflow_slug        String
  thread_id            String?
  delivery_id          String?
  session_id           String?
  opencode_session_id  String?
  wait_type            String
  status              String
  question_to_user     String
  prompt_to_ai         String?
  resume_state_json    String
  created_at           BigInt
  resumed_at           BigInt?
}
```

Suggested `wait_type` values:

- `user_input`
- `approval_rejected`
- `agent_question`

Suggested statuses:

- `waiting`
- `resumed`
- `cancelled`
- `expired`

The platform state tracks the wait. The workflow-owned `resume_state_json` is opaque to TeamCopilot and is passed back into the workflow on resume.

## Structured Workflow Result Protocol

Introduce explicit structured outputs for workflows.

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
      action_type: string;
      action_payload: Record<string, unknown>;
      resume_state: Record<string, unknown>;
    };
```

Existing stdout/stderr logs should continue to be captured, but workflow control should be based on a structured result envelope.

Example result:

```json
{
  "status": "needs_user_input",
  "question_to_user": "What should I reply with?",
  "prompt_to_ai": "Ask the user what WhatsApp reply should be sent. Do not send anything directly.",
  "resume_state": {
    "step": "waiting_for_replacement_reply",
    "to": "+15551234567",
    "incoming_message": "Can you check my order?",
    "draft_reply": "Your order arrives tomorrow.",
    "event_delivery_id": "evt_123"
  }
}
```

## Workflow Continuation

Continuation should not resume the same OS process.

Instead:

```text
workflow returns wait result
  -> TeamCopilot stores resume_state
  -> workflow process exits
  -> user replies later
  -> TeamCopilot starts a new workflow run in resume mode
  -> workflow receives resume_state and user input
```

This is restart-safe and works across deploys, timeouts, and crashes.

The workflow is a resumable state machine:

```text
initial(input)
  -> success
  -> failed
  -> needs_approval(resume_state)
  -> needs_user_input(resume_state)

resume(resume_state, user_input or approval_result)
  -> success
  -> failed
  -> needs_approval(new_resume_state)
  -> needs_user_input(new_resume_state)
```

The workflow owns the meaning of `resume_state.step`.

## Workflow Context File

Do not pass complex event and resume state through CLI flags.

Add a reserved context file:

```text
TEAMCOPILOT_CONTEXT_FILE=/tmp/teamcopilot-context-abc.json
```

Initial context:

```json
{
  "mode": "initial",
  "input": {
    "incoming_message": {
      "from": "+15551234567",
      "text": "Can you check my order?"
    }
  },
  "event": {
    "delivery_id": "evt_123",
    "thread_id": "thread_123",
    "provider": "whatsapp"
  }
}
```

Resume context:

```json
{
  "mode": "resume",
  "input": {
    "incoming_message": {
      "from": "+15551234567",
      "text": "Can you check my order?"
    }
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

## Workflow Helper API

Ship a small helper package available inside workflow virtual environments.

Example Python API:

```python
from teamcopilot import workflow

ctx = workflow.context()

workflow.success({"message": "done"})
workflow.fail("Could not process the request")
workflow.need_user_input(
    question="What should I reply with?",
    prompt_to_ai="Ask the user for the replacement WhatsApp reply.",
    resume_state={
        "step": "waiting_for_replacement_reply",
        "to": "+15551234567"
    },
)
workflow.needs_approval(
    action_type="send_whatsapp_message",
    action_payload={
        "to": "+15551234567",
        "message": "Your order arrives tomorrow."
    },
    resume_state={
        "step": "waiting_for_send_approval",
        "to": "+15551234567",
        "message": "Your order arrives tomorrow."
    },
)
```

The helper should only read the context file and emit structured result JSON. The backend owns waits, approvals, secret resolution, and external action execution.

## Example Workflow Script

```python
from teamcopilot import workflow

def create_draft_reply(incoming):
    return "Your order is expected to arrive tomorrow by 6 PM."

def main():
    ctx = workflow.context()

    if ctx.mode == "resume":
        state = ctx.resume["state"]
        user_input = ctx.resume["user_input"]

        if state["step"] == "waiting_for_replacement_reply":
            workflow.needs_approval(
                action_type="send_whatsapp_message",
                action_payload={
                    "to": state["to"],
                    "message": user_input,
                },
                resume_state={
                    **state,
                    "step": "waiting_for_send_approval",
                    "replacement_reply": user_input,
                },
            )
            return

        workflow.fail(f"Unknown resume step: {state['step']}")
        return

    incoming = ctx.input["incoming_message"]
    draft_reply = create_draft_reply(incoming)

    workflow.needs_approval(
        action_type="send_whatsapp_message",
        action_payload={
            "to": incoming["from"],
            "message": draft_reply,
        },
        resume_state={
            "step": "waiting_for_send_approval",
            "to": incoming["from"],
            "incoming_message": incoming["text"],
            "draft_reply": draft_reply,
        },
    )

if __name__ == "__main__":
    main()
```

## User Reply Handling

When a user sends a message in a TeamCopilot chat session:

```text
POST /api/chat/sessions/:id/messages
```

The backend should check whether the session has an active wait:

```text
find workflow_waits where session_id = :id and status = waiting
```

If there is no active wait, handle the message as normal chat.

If there is an active wait:

- Send the user's message to the linked agent session if needed.
- Mark the wait as `resumed`.
- Mark the processing run as `running`.
- Start a new workflow run in resume mode with:
  - original input
  - `resume_state_json`
  - user input
  - wait id
- Process the new structured workflow result.

## WhatsApp End-to-End Flow

```text
WhatsApp inbound webhook
  -> /api/ingress/webhooks/whatsapp-inbound
  -> verify Meta signature
  -> normalize payload
  -> find/create external_thread
  -> create event_delivery
  -> start processing_run
  -> run workflow
  -> workflow returns needs_approval(send_whatsapp_message)
  -> create pending_external_action
  -> user approves or rejects
```

Approve:

```text
user approves
  -> backend sends WhatsApp message with global/user secret
  -> pending_external_action executed
  -> processing_run success
  -> event_delivery success
```

Reject:

```text
user rejects
  -> pending_external_action rejected
  -> create workflow_wait with resume_state
  -> reveal or create linked TeamCopilot session
  -> ask user what to send instead
  -> user replies
  -> rerun workflow in resume mode
  -> workflow proposes new send_whatsapp_message action
  -> user approves
  -> backend sends message
```

## Approval and Resource Safety

Event handlers should use existing resource approval concepts with:

```text
resource_kind = "event-handler"
resource_slug = handler slug
```

Before a handler can process production events:

- The handler filesystem snapshot must be approved.
- Required secrets must be present.
- The target workflow or static code must be approved.
- The external action type must be allowed for the handler.

## Implementation Phases

1. Add `event_deliveries`, `external_threads`, `processing_runs`, `pending_external_actions`, and `workflow_waits` schema.
2. Add `event-handlers/<slug>/handler.json` loader and validation.
3. Add `/api/ingress/webhooks/:handlerSlug` route.
4. Add generic processing dispatcher.
5. Add structured workflow result parsing.
6. Add `TEAMCOPILOT_CONTEXT_FILE` support to workflow runner.
7. Add workflow resume mode.
8. Add pending external action APIs and UI.
9. Add WhatsApp provider verification and send action executor.
10. Add user reply continuation handling in chat message endpoint.
11. Add event handler and delivery history UI.
12. Add retry and replay support for failed deliveries.

## Non-Goals For First Version

- Arbitrary long-running user-hosted servers.
- Keeping workflow processes alive while waiting for humans.
- Refactoring cronjobs into the event handler system.
- Supporting many provider-specific action types upfront.
- Complex visual workflow builders.

## Future Direction

Once event handlers are stable, cronjobs can become another trigger type in the same automation model:

```text
trigger.type = "cron"
trigger.type = "webhook"
trigger.type = "manual"
trigger.type = "email"
trigger.type = "polling"
```

This should happen after webhook/event delivery semantics, waits, actions, and resumable workflows are proven with WhatsApp.
