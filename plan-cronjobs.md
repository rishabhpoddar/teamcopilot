# Cronjobs Feature Plan

## Summary

Add user-owned cronjobs that launch an autonomous agent session on a schedule.
Each cronjob belongs to a single user, stores its schedule in the database, and runs with that user's identity and secret context.

The default behavior should strongly bias the agent toward completing the task without bothering the user.
If the agent hits a hard permission boundary or another true blocker, the run should escalate into a regular chat session for that same user so the conversation can continue normally.

This document is the source of truth for the feature before implementation.

## Product Goals

- Let any user create and manage their own cronjobs.
- Let a cronjob start from a natural-language prompt.
- Let the prompt drive the agent to do anything the platform already supports:
  - chat
  - run a workflow
  - use a skill
  - perform other agentic actions available in a normal session
- Make the default run path autonomous and low-friction (when the cronjob is created, users have to choose if workflows can run without user permission).
- Only ask the user when the agent truly cannot proceed without approval or permission.
- If a cronjob run escalates, preserve the same user context and continue as a normal chat session.

## Non-Goals

- Shared/team-owned cronjobs in v1.
- Per-cronjob multi-user approval flows in v1.
- Distributed scheduling across multiple backend replicas in v1.
- Backfilling missed triggers after downtime in v1.
- A new workflow engine. Cronjobs should reuse existing session, permission, workflow, and skill primitives.

## Proposed UX

Add a dedicated `Cronjobs` area in the dashboard.

The user should be able to:

- create a cronjob
- name it
- write the prompt
- choose a schedule
- choose a timezone
- decide whether workflow runs may proceed without user permission (default to true - i.e. no permission required)
- enable or disable the cronjob
- see the next run time
- see run history, and the agent execution trace (everything that the agent said and did during the run)
- see whether a run needs user input and opened a chat session

The schedule editor should support:

- a friendly preset path for common schedules
- an advanced raw cron expression path
- an explicit timezone selector using IANA timezones

## Behavior Model

### Creation

When a user creates a cronjob, store:

- owner user id
- display name
- prompt
- enabled state
- workflow permission policy
- timestamps

### Execution

On each due trigger:

1. The scheduler checks whether the cronjob is enabled.
2. If another run is already active for the same cronjob, skip the new trigger and record it as skipped.
3. Otherwise, create a new run record.
4. Start an autonomous agent session as the cronjob owner.
5. Seed the session with the cronjob prompt and strong instructions to avoid asking the user for help unless it is unavoidable + available secrets and skills (similar to a normal chat session)
6. Let the agent proceed with normal platform tools.
7. If a permission gate cannot be avoided:
   - create a regular chat session for the same user
   - attach the cronjob run to that chat session
   - mark the cronjob run as needing user input
   - surface the chat session to the user as an attention item
   - continue from there as a standard chat conversation

### Permission Policy

Cronjobs need one explicit policy flag:

- `allow_workflow_runs_without_permission`

If true:

- workflows triggered by the cronjob may proceed without requiring user permission, subject to the existing workflow approval and runtime boundaries already enforced by the platform.

If false:

- workflow execution should behave conservatively and escalate when permission would otherwise be needed.

This policy is intentionally narrower than "agent can do anything". It only controls whether workflow runs are allowed to skip the user prompt path.

### Escalation

Escalation should happen when the autonomous run hits a real boundary that cannot be safely bypassed.

Examples:

- a workflow requires explicit permission and the cronjob policy does not allow bypass
- the agent encounters another platform-level approval or permission gate
- a resource access boundary cannot be resolved automatically

Escalation behavior:

- create a standard `chat_sessions` row for the cronjob owner
- link the cronjob run to that chat session
- keep the session visible in the normal chat UI
- mark the session as needing attention so the user can see that the cronjob is waiting on them
- from that point on, the user handles it like any other session

The cronjob runtime should not invent a separate "approval session" type if the existing chat session model can already carry the conversation forward.

### Completion and User Attention

The cronjob runtime should use a single explicit completion signal from the agent:

- if the agent calls the cronjob completion tool, the run is `success`
- if the tool loop stops without the completion tool being called, the run is `needs_user_input`
- if the runtime errors, times out, or is aborted, the run is `failed`

This avoids asking the agent to classify whether it is blocked.
The agent only gets one explicit terminal tool: "mark this cronjob completed."

The cronjob session should expose a completion tool such as `markCronjobCompleted` with this contract:

- `summary`: short human-readable run summary

The agent must call this tool exactly once after it has completed the cronjob's requested work.
The cronjob preamble should make this mandatory and should explain that not calling the tool means the session will be handed to the user.

When a run finishes successfully:

- store the run as `success`
- store the summary returned by the completion tool
- keep the result visible from the cronjob run history
- do not create a normal chat session item unless one already exists

When a run fails:

- store the run as `failed`
- show the error in cronjob run history
- do not interrupt the user through chat unless the failure also produced an actionable pending session

When a run needs user input:

- store the run as `needs_user_input`
- create or reveal the linked chat session
- set the chat session state so it appears in the AI chat list as needing attention
- show clear cronjob context in the chat header or first visible message, including the cronjob name and prompt snapshot
- keep the cronjob run linked to that chat session for audit history
- infer the user-input reason from the stopped state: pending tool question, pending permission request, last assistant message, or a generic "cronjob stopped before marking itself complete"

The runtime classification rule is:

- while the opencode tool loop is active, the cronjob remains `running`
- if `markCronjobCompleted` is called, mark the run `success`
- if the loop stops and `markCronjobCompleted` was not called, mark the run `needs_user_input` and reveal the linked chat session
- if the runtime fails independently of agent control flow, mark the run `failed`

## Database Plan

This feature should be database-backed, not filesystem-backed.

### New Tables

#### `cronjobs`

Suggested columns:

- `id` - primary key
- `user_id` - owner
- `name` - display name
- `prompt` - the cron prompt text
- `enabled` - boolean
- `allow_workflow_runs_without_permission` - boolean
- `created_at`
- `updated_at`

Optional columns if needed later:

- `description`

#### `cronjob_schedules`

Suggested columns:

- `cronjob_id` - unique foreign key to `cronjobs`
- `schedule_type` - `preset` or `cron`
- `preset_key` - nullable preset identifier
- `cron_expression` - nullable normalized cron expression
- `timezone` - IANA timezone string
- `created_at`
- `updated_at`

Normalization rule:

- exactly one of `preset_key` or `cron_expression` must be set
- if `schedule_type` is `preset`, `preset_key` is required and `cron_expression` is derived from the preset
- if `schedule_type` is `cron`, `cron_expression` is required and `preset_key` is null

#### `cronjob_runs`

Suggested columns:

- `id` - primary key
- `cronjob_id` - foreign key to `cronjobs`
- `status` - `running`, `success`, `failed`, `skipped`, `needs_user_input`
- `started_at`
- `completed_at`
- `prompt_snapshot` - prompt copy used for the run
- `summary` - nullable short summary supplied by the cronjob completion tool
- `session_id` - linked chat session id if any
- `opencode_session_id` - runtime session id
- `needs_user_input_reason` - nullable string inferred by the runtime when the tool loop stops without completion
- `error_message` - nullable string

Optional columns if needed later:

- `workflow_run_id` if a cronjob run directly launches a tracked workflow execution
- `trigger_source` if we later support manual re-run or ad hoc dispatch

Normalization notes:

- do not store `user_id` on `cronjob_runs`; derive ownership through `cronjob_id`
- do not store `scheduled_for`; for v1, a run record represents the trigger that was actually processed at `started_at`
- do not store full output; the agent trace should come from the linked opencode/chat session
- keep `summary` because the run list needs a compact outcome without reading the full session trace
- keep `prompt_snapshot` because editing the cronjob prompt later would otherwise change the historical meaning of past runs

### Indexes and Constraints

Recommended:

- unique cronjob ownership/name pair if names should be unique per user
- index on `user_id`
- index on `enabled`
- index on `cronjob_id`
- index on `cronjob_id, started_at`
- index on `cronjob_id, status`

### Migration Notes

- Add the tables via Prisma schema changes.
- Generate a migration with the Prisma migration workflow.
- Do not hand-edit the Prisma migration file unless the migration itself requires a data backfill step.

## Scheduler Plan

### Runtime

The backend process should own scheduling for now.

At startup:

- load enabled cronjobs from the database
- load each cronjob's schedule row
- compute next run times from schedule definitions
- schedule in-process timers

At runtime:

- when a timer fires, dispatch the cronjob run
- after completion, recompute the next run from the schedule row and recent run history

### Overlap Policy

If a cronjob fires while the previous run is still active:

- do not start a second run
- record the trigger as skipped
- continue to the next scheduled time

This avoids duplicate work and reduces the chance of multiple user-attention sessions for the same cronjob.

### Downtime Policy

If the backend was down when a run should have fired:

- do not backfill missed triggers in v1
- recompute the next future schedule time

### Timezone Policy

Schedules should be interpreted using an explicit IANA timezone stored on the cronjob's schedule row.

The UI should default the timezone from the creator's browser timezone or a project default if that is unavailable.

## Execution Plan

### Session Bootstrap

For each cronjob run:

- create or reuse an opencode session as the cronjob owner
- seed the session with:
  - a cronjob runtime instruction block
  - the cronjob prompt
  - instructions to avoid asking the user questions unless absolutely necessary
  - the user's available skills and secrets context
  - the workflow permission policy
- this session should be marked as a cronjob run, which means that it will not show up in the user's chat list unless it needs user input. If it does need user input, the chat UI should clearly show that the session came from a cronjob run.

### Cronjob First Message Instructions

The first message in a cronjob session should include an explicit runtime contract before the user's cronjob prompt.

It should tell the agent:

- this is an unattended scheduled run
- the agent should keep working until the task is complete or the tool loop is blocked
- the agent should not ask the user questions in normal prose
- the agent should make reasonable assumptions and continue when safe
- the only way to mark the cronjob finished is to call `markCronjobCompleted`
- if the tool loop stops without `markCronjobCompleted`, TeamCopilot will reveal the session to the user as needing attention
- `markCronjobCompleted` must only be called after the requested work is actually complete
- the completion summary should be concise and suitable for cronjob run history

### Strong Autonomous Bias

The session preamble should explicitly tell the agent to:

- prefer taking action over asking for clarification
- use available workflows and skills when they fit the task
- make reasonable assumptions when the prompt is underspecified
- only escalate when blocked by an actual permission or safety boundary
- avoid asking the user to "confirm" routine decisions
- call the cronjob completion tool exactly once after the requested work is complete
- understand that stopping without calling the completion tool will reveal the session to the user as needing attention

The point is not to make the agent reckless.
The point is to reduce avoidable user interruptions while staying inside the platform's existing guardrails.

### Workflow Invocation

Cronjob runs should reuse the existing workflow execution model.

If the cronjob prompt causes a workflow to run:

- use the existing workflow runtime path
- honor current workflow approval and permission rules
- consult `allow_workflow_runs_without_permission` before asking the user

### Escalation to Chat

If escalation is needed:

- create a standard chat session row owned by the same user
- attach the run to that session
- mark the cronjob run as `needs_user_input`
- surface the session in the regular chat experience
- make the session appear as an attention item, not as a background/completed cronjob run
- continue using the existing chat permission-response and tool-answer mechanisms

This keeps the feature aligned with current product flows instead of inventing a parallel approval surface.

### Cronjob Control Tool

The cronjob runtime should provide a tool that is only available inside cronjob sessions.
This tool is the only agent-declared terminal signal.

Suggested tool name:

- `markCronjobCompleted`

Suggested input:

- `summary`: required string

Behavior:

- calling the tool updates the run to `success`, sets `completed_at`, stores `summary`, and keeps the session hidden from the normal chat list
- if the opencode tool loop stops before this tool is called, the runtime updates the run to `needs_user_input`, creates or reveals the linked chat session, infers `needs_user_input_reason`, and marks the session as needing attention
- duplicate calls should fail because each run can have only one terminal state
- the tool should fail if platform-level pending permission or pending question state still exists for the session

## API Plan

Add cronjob CRUD and runtime inspection APIs.

Suggested endpoints:

- `GET /api/cronjobs`
- `POST /api/cronjobs`
- `GET /api/cronjobs/:id`
- `PATCH /api/cronjobs/:id`
- `DELETE /api/cronjobs/:id`
- `POST /api/cronjobs/:id/enable`
- `POST /api/cronjobs/:id/disable`
- `GET /api/cronjobs/:id/runs`
- `POST /api/cronjobs/:id/run-now` if we want manual trigger support in v1

Suggested runtime endpoints:

- `GET /api/cronjobs/runs/:id`
- `POST /api/cronjobs/runs/:id/stop` if the run is still active
- `POST /api/cronjobs/runs/:id/complete` internal authenticated endpoint used only by the cronjob completion tool

Open decision:

- whether the API should expose direct "run now" support in v1 or wait for a follow-up

## Frontend Plan

Add a new dashboard tab for cronjobs with:

- list view
- create/edit form
- schedule editor
- timezone selector
- workflow permission toggle
- enable/disable control
- run history
- latest status and next-run preview
- attention state for cronjob runs waiting on the user

The form should make the autonomous default obvious.
The copy should explain that the cronjob will only interrupt the user if it hits a real permission boundary.

## Auditability

Every run should be auditable:

- who owns it
- what prompt started it
- when it ran
- whether it skipped due to overlap
- whether it needed user input and linked into chat
- what permission boundary caused the user-input request
- any final error text

## Failure Modes

- Invalid cron expression
  - reject on create/update
- Invalid timezone
  - reject on create/update
- Backend restart
  - rehydrate enabled cronjobs from DB
- Active run on trigger
  - skip and record it
- Permission boundary during execution
  - mark run as `needs_user_input`, reveal the linked chat session, and show it as needing attention
- User deleted
  - cronjobs owned by that user should be cleaned up or disabled as part of user deletion flow

## Test Plan

Backend tests should cover:

- cronjob create/update/delete/list
- schedule validation
- timezone validation
- enable/disable behavior
- next-run calculation
- overlap skipping
- scheduler rehydration on startup
- run record creation
- `needs_user_input` path to chat session creation
- workflow permission policy handling

Frontend tests or checks should cover:

- cronjob tab visibility
- create/edit form submission
- timezone selection
- schedule preview
- run history rendering
- disabled/enabled state handling

Integration checks should cover:

- backend build
- frontend build
- targeted test suite
- a manual smoke test of one cronjob path end to end

## Assumptions

- Cronjobs are owned by a single user in v1.
- The scheduler runs inside the main backend process.
- The database is the source of truth for cronjob definitions, schedule definitions, and run state.
- Missed runs are skipped, not backfilled.
- Escalation should prefer reusing the existing chat session model over introducing a new approval session model.
- Timezones use IANA names.
- The `allow_workflow_runs_without_permission` flag only governs workflow permission behavior, not every possible platform action.

## Open Questions

These are the main points to settle before code work begins:

- Should `run-now` exist in v1?
- Should cronjob names be unique per user?
- Should runs that need user input create a brand-new chat session every time, or reuse an existing "cronjob thread" per cronjob?
- Should we add a manual "test this cronjob" action in the UI at launch?
