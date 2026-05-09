# Cronjobs Feature Plan

## Summary

TeamCopilot supports user-owned cronjobs that launch autonomous agent sessions on a schedule.
Each cronjob belongs to one user, stores its schedule in normalized database tables, and runs with that user's identity, permissions, skills, and secret context.

The runtime is designed to strongly bias the agent toward completing work without user input.
The agent must explicitly finish a run by calling `markCronjobCompleted`.
If the tool loop stops before that completion tool is called, the run is treated as needing user input and the hidden chat session is revealed.

Users can also manually start a cronjob, monitor a running run in real time, review the same transcript after the run finishes, and stop a run while it is active.

## Product Goals

- Let any user create and manage their own cronjobs.
- Let a cronjob start from a natural-language prompt.
- Let the prompt drive the agent to use normal TeamCopilot capabilities:
  - chat
  - workflows
  - skills
  - file edits
  - other available agent tools
- Make the default run path autonomous and low-friction.
- Let the creator decide whether workflow runs can proceed without an extra user permission prompt.
- Reveal the run as a normal chat only when the agent truly needs user help.
- Preserve an auditable transcript for every non-skipped run.
- Allow the user to monitor live progress and stop a running cronjob.

## Non-Goals

- Shared/team-owned cronjobs in v1.
- Per-cronjob multi-user approval flows in v1.
- Distributed scheduling across multiple backend replicas in v1.
- Backfilling missed triggers after downtime in v1.
- A new workflow engine. Cronjobs reuse existing session, permission, workflow, skill, and chat primitives.

## UX Model

Cronjobs live under a dedicated `Cronjobs` dashboard tab.

The tab is an overview, not an inline editor. It shows:

- a `Create Cronjob` button
- cronjob cards
- enabled/disabled state
- current running state
- next run time
- latest run status
- workflow permission policy
- actions:
  - `Run now`
  - `Monitor` for active runs
  - `Stop` for active runs
  - `View messages` for completed latest runs
  - `Runs` for run history
  - `Enable` / `Disable`
  - `Edit`
  - `Delete`

Creation and editing use dedicated routes:

- `/cronjobs/new`
- `/cronjobs/:id/edit`

Run monitoring and historical transcript review use one shared route:

- `/cronjobs/runs/:runId`

That route shows:

- run status
- started/completed timestamps
- summary, failure text, or user-input reason when present
- the agent/user transcript from the linked chat session
- live SSE updates while the run is still running
- a `Stop run` button while the run is still running

This is intentionally the same path for both live monitoring and finished-run review.

## Schedule UX

The schedule editor supports:

- structured schedules such as daily, selected weekdays, monthly, and alternate-week patterns
- advanced raw cron expression
- explicit IANA timezone

The UI stores `schedule_type` to distinguish raw cron schedules from structured schedules whose fields are edited individually.

## Behavior Model

### Creation

When a user creates a cronjob, store:

- owner user id
- display name
- prompt
- enabled state
- workflow permission policy
- schedule row
- timestamps

### Scheduled Execution

On each due trigger:

1. The scheduler checks whether the cronjob is enabled.
2. If another run is already active for the same cronjob, record a `skipped` run and do not start a second agent session.
3. Otherwise, create a new opencode session.
4. Create a hidden linked `chat_sessions` row with `source = cronjob` and `visible_to_user = false`.
5. Create a `cronjob_runs` row with `status = running`.
6. Seed the session with the cronjob runtime preamble and prompt.
7. Let the agent proceed through normal TeamCopilot tools.
8. Keep the run `running` while the opencode session is busy or retrying.
9. If the agent calls `markCronjobCompleted`, mark the run `success`.
10. If the opencode session becomes idle without `markCronjobCompleted`, keep the run `running` and reveal the linked chat session.

### Manual Run

Users can manually trigger a cronjob with `Run now`.

Manual run behavior:

- manual runs can be started even if the cronjob is disabled
- manual runs cannot overlap with an existing active run for the same cronjob
- if a run is already active, the API returns `409 Cronjob is already running`
- after a manual run starts, the UI opens `/cronjobs/runs/:runId` for live monitoring

Scheduled overlap still records a `skipped` run. Manual overlap does not create a skipped run because it is an interactive user action.

### Stop

Users can stop an active run from:

- the cronjob card in the overview
- the run transcript page

Stop behavior:

- abort the linked opencode session
- mark the run `failed`
- set `completed_at`
- set `error_message = "Cronjob run was stopped by the user."`
- keep the transcript available at `/cronjobs/runs/:runId`

### Live Monitoring And Transcript Review

Every non-skipped run has a linked chat session.
The linked session is hidden from the normal chat list while the run is autonomous, but it can still be viewed through the cronjob run page.

The run page uses the existing chat transcript and SSE event stream in fixed-session read-only mode:

- while the run is active, messages and tool updates stream in real time
- after the run finishes, the same route shows the final transcript
- the page does not expose the hidden session in the normal AI chat sidebar
- if the run is `running` and the linked session is revealed, the UI treats it as needing user input and the user can continue the conversation

This avoids creating separate monitoring and history surfaces.

### Permission Policy

Cronjobs have one explicit policy flag:

- `prompt_allow_workflow_runs_without_permission`

If true:

- workflows triggered by the cronjob may proceed without an extra user permission prompt, subject to existing workflow approval and runtime boundaries.

If false:

- workflow execution behaves conservatively
- if a workflow permission prompt would normally be required, the opencode loop can stop and the linked chat session is revealed

This flag only controls workflow permission prompt behavior.
It does not remove platform safety boundaries or grant arbitrary permissions.

### Completion Signal

The cronjob runtime uses one explicit agent terminal signal:

- `markCronjobCompleted(summary)`

The agent must call this tool exactly once after the requested cronjob work is complete.

Runtime classification:

- while the opencode tool loop is active, the cronjob remains `running`
- if `markCronjobCompleted` is called, mark the run `success`
- if the loop becomes idle and `markCronjobCompleted` was not called, keep the run `running` and reveal the linked chat session
- if runtime startup fails or the user stops the run, mark the run `failed`
- set `completed_at` whenever a run leaves `running`, including `success`, `failed`, and `skipped`

The agent is not asked to classify whether it needs user input.
Only the runtime makes that classification.

## Database Plan

Cronjobs are database-backed.

### `cronjobs`

Columns:

- `id` - primary key
- `user_id` - owner user id
- `name` - display name
- `enabled` - boolean
- `target_type` - `prompt` or `workflow`
- `prompt` - nullable cron prompt text for prompt cronjobs
- `prompt_allow_workflow_runs_without_permission` - nullable boolean for prompt cronjobs
- `workflow_slug` - nullable workflow slug for workflow cronjobs
- `workflow_input_json` - nullable validated workflow inputs JSON for workflow cronjobs
- `preset_key` - nullable preset identifier
- `cron_expression` - nullable raw cron expression
- `timezone` - IANA timezone string
- `schedule_type` - `cron` or `structured`
- `time_minutes` - nullable minute-of-day for structured schedules
- `days_of_week` - nullable comma-separated day list for structured weekly schedules
- `week_interval` - nullable interval for alternate-week structured schedules
- `anchor_date` - nullable YYYY-MM-DD anchor for alternate-week schedules
- `day_of_month` - nullable day-of-month for structured monthly schedules
- `created_at` - bigint timestamp
- `updated_at` - bigint timestamp

Relations:

- belongs to `users`
- has many `cronjob_runs`

Constraints/indexes:

- unique `(user_id, name)`
- index `user_id`
- index `enabled`
- index `target_type`
- index `workflow_slug`

Normalization rule:

- exactly one of `preset_key` or `cron_expression` must be set
- if `preset_key` is set, derive the effective cron expression from the server-side preset registry
- if `cron_expression` is set, use it directly
- do not store `next_run_at`; compute it from schedule and current time
- target and schedule columns live on `cronjobs` because each cronjob has exactly one target and exactly one schedule

### `cronjob_runs`

Columns:

- `id` - primary key
- `cronjob_id` - foreign key to `cronjobs`
- `status` - `running`, `success`, `failed`, `skipped`
- `started_at` - bigint timestamp
- `completed_at` - nullable bigint timestamp
- `workflow_run_id` - nullable linked workflow run id for workflow cronjobs
- `summary` - nullable short summary supplied by `markCronjobCompleted`
- `session_id` - nullable linked chat session id
- `opencode_session_id` - nullable runtime session id
- `error_message` - nullable error text

Indexes:

- `(cronjob_id, started_at)`
- `(cronjob_id, status)`
- `workflow_run_id`

Normalization notes:

- do not store `user_id`; derive ownership through `cronjob_id`
- do not store `scheduled_for`; a run record represents the trigger that was actually processed at `started_at`
- do not store full output; the agent trace comes from the linked opencode/chat session
- keep `summary` for compact run history
- require `session_id` for all non-skipped runs
- `skipped` runs have no session and should set `completed_at = started_at`
- do not store `last_run_at`; derive it from latest `cronjob_runs`
- do not store run target snapshots; prompt run history uses the linked chat transcript, and workflow run history links to the immutable workflow run logs
- do not store a `needs_user_input` status; derive that state from `cronjob_runs.status = running` plus `chat_sessions.visible_to_user = true`

### `chat_sessions` Additions

Columns:

- `source` - `user` or `cronjob`
- `visible_to_user` - boolean

Behavior:

- normal user-created chats use `source = user` and `visible_to_user = true`
- cronjob sessions use `source = cronjob` and `visible_to_user = false` while autonomous
- cronjob run pages can still load hidden sessions by run ownership
- normal chat session list APIs exclude hidden sessions
- when a running prompt cronjob needs user input, set `visible_to_user = true`
- `cronjob_runs.session_id` is the only DB link from a run to its chat session

Index:

- `(source, visible_to_user)`

## Scheduler Plan

The main backend process owns scheduling in v1.

At startup:

- load enabled cronjobs from the database
- load each cronjob's schedule row
- schedule each enabled cronjob in memory

At runtime:

- when a timer fires, dispatch the cronjob run
- schedule calculation is based on the cron expression and timezone
- disabled cronjobs are unscheduled
- create/update/delete/enable/disable operations reschedule the affected cronjob

Downtime policy:

- do not backfill missed triggers in v1
- recompute the next future schedule after backend restart

Overlap policy:

- only `running` runs block overlap
- scheduled overlap creates a `skipped` run
- manual overlap returns `409`
- previous `failed`, `success`, and `skipped` runs do not block future scheduled runs

## Execution Plan

### Session Bootstrap

For each non-skipped cronjob run:

- create a new opencode session as the cronjob owner
- create a hidden linked `chat_sessions` row
- create/update the `cronjob_runs` row with `session_id` and `opencode_session_id`
- seed the session with:
  - cronjob runtime instructions
  - the user's cronjob prompt
  - available approved skills
  - available user/global secret keys
  - workflow permission policy

### Cronjob First Message Instructions

The first message tells the agent:

- this is an unattended scheduled TeamCopilot cronjob run
- keep working until the requested task is complete or blocked by a real permission/tool/safety boundary
- do not ask the user questions in normal prose
- make reasonable assumptions and continue when safe
- the only way to mark the cronjob finished is to call `markCronjobCompleted`
- if the tool loop stops without `markCronjobCompleted`, TeamCopilot will reveal the session to the user as needing attention
- call `markCronjobCompleted` only after the requested work is actually complete
- the completion summary must be concise and suitable for run history
- workflow runs may or may not bypass user permission prompts depending on `prompt_allow_workflow_runs_without_permission`

### Strong Autonomous Bias

The preamble should push the agent to:

- prefer taking action over asking for clarification
- use workflows and skills when appropriate
- make reasonable assumptions when the prompt is underspecified
- avoid asking for routine confirmations
- stop without completing only when blocked by a real boundary
- call `markCronjobCompleted` exactly once when done

This should not make the agent reckless.
Existing tool, permission, approval, and safety boundaries still apply.

### Cronjob Completion Tool

Tool:

- `markCronjobCompleted`

Input:

- `summary`: required string

Behavior:

- finds the running cronjob run for the current opencode session
- fails if there is pending question or permission state
- updates the run to `success`
- sets `completed_at`
- stores `summary`
- leaves the linked session hidden from the normal chat list

## API Plan

Cronjob CRUD:

- `GET /api/cronjobs`
- `POST /api/cronjobs`
- `GET /api/cronjobs/:id`
- `PATCH /api/cronjobs/:id`
- `DELETE /api/cronjobs/:id`
- `POST /api/cronjobs/:id/enable`
- `POST /api/cronjobs/:id/disable`

Run APIs:

- `GET /api/cronjobs/:id/runs`
- `POST /api/cronjobs/:id/run-now`
- `GET /api/cronjobs/runs/:id`
- `POST /api/cronjobs/runs/:id/stop`
- `POST /api/cronjobs/runs/complete-current`

Response notes:

- `GET /api/cronjobs` returns `next_run_at`, `latest_run`, `is_running`, and `current_run_id`
- `run-now` returns the new `run_id`
- `complete-current` is used by the opencode `markCronjobCompleted` plugin and requires an opencode session token

Chat APIs reused by cronjob run pages:

- `GET /api/chat/sessions/:sessionId/messages`
- `GET /api/chat/sessions/:sessionId/events`
- `GET /api/chat/sessions/:sessionId/file-diff`

These work for hidden cronjob sessions because authorization is based on session ownership, not `visible_to_user`.

## Frontend Plan

Implemented frontend surfaces:

- dashboard `Cronjobs` tab for overview and actions
- `/cronjobs/new` for create
- `/cronjobs/:id/edit` for edit
- `/cronjobs/runs/:runId` for monitoring and transcript review

The overview supports:

- create button
- enabled/disabled status
- running indicator
- next run
- latest run
- run-now
- monitor active run
- stop active run
- view latest run messages
- expanded run history
- edit/delete/enable/disable

The form supports:

- guided prompt authoring
- schedule presets
- raw cron expression
- timezone
- enabled toggle
- workflow permission toggle

The run page supports:

- live transcript streaming while running
- transcript review after completion
- run metadata
- stop button for active runs
- read-only chat transcript mode

## Auditability

Every run should make these facts inspectable:

- cronjob owner
- prompt snapshot
- schedule at time of definition
- started time
- completed time
- status
- skipped overlap state
- linked session transcript for non-skipped runs
- completion summary
- user-input reason
- final error text
- whether the user stopped the run

## Failure Modes

- Invalid cron expression:
  - reject on create/update
- Invalid timezone:
  - reject on create/update
- Backend restart:
  - rehydrate enabled cronjobs from DB
- Scheduled active overlap:
  - create `skipped` run
- Manual active overlap:
  - return `409 Cronjob is already running`
- Permission boundary during execution:
  - keep run `running`, reveal linked chat session, show it as needing attention
- User stop:
  - abort opencode session, mark run `failed`, store stop message
- User deleted:
  - cronjobs owned by that user cascade/delete through DB relations

## Test Plan

Backend tests/checks should cover:

- cronjob create/update/delete/list
- schedule validation
- timezone validation
- enable/disable behavior
- next-run calculation
- scheduled overlap skipping
- manual overlap conflict
- scheduler rehydration on startup
- run record creation
- run-now behavior
- stop behavior
- user-input handoff for a running revealed cronjob session
- workflow permission policy handling
- completion tool success path
- completion tool rejection when pending permission/question exists

Frontend tests/checks should cover:

- cronjobs tab visibility
- create route
- edit route
- schedule mode switching
- timezone field
- workflow permission toggle
- run-now navigation to run page
- monitor action for active runs
- stop action for active runs
- view messages for completed runs
- read-only transcript rendering
- live SSE transcript updates

Integration checks:

- `npm run build`
- manual smoke test:
  - create cronjob
  - run now
  - monitor messages
  - stop a running run
  - review transcript after completion/failure

## Assumptions

- Cronjobs are owned by a single user in v1.
- The scheduler runs inside the main backend process.
- The database is the source of truth for definitions, schedules, and run state.
- Missed runs are skipped, not backfilled.
- Each non-skipped run gets its own chat session.
- Hidden cronjob sessions are not listed in normal chat until they need user input.
- The cronjob run page can view hidden sessions because the run belongs to the current user.
- Timezones use IANA names.
- `prompt_allow_workflow_runs_without_permission` only governs workflow permission prompting from prompt cronjobs.

## Settled Decisions

- `run-now` is included in v1.
- Cronjob names are unique per user.
- Each non-skipped run creates a new chat session.
- The same `/cronjobs/runs/:runId` page handles live monitoring and historical transcript review.
- Users can stop active runs midway.
- `last_run_at`, `next_run_at`, `scheduled_for`, run target snapshots, `needs_user_input`, and run-level `user_id` are not stored.

## Pending todos:
- Allow workflows to be scheduled as well in crons
- Allow AI agent to schedule / edit / delete cronjobs so users dont need to always create crons via the UI
