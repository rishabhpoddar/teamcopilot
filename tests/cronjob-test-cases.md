# Cronjob Branch Test Cases

This checklist tracks regression coverage for the cronjob branch diff against `main`.

## Cronjob Schedule And Target Validation

- [x] Accept 5-field cron expressions and trim whitespace. Covered by `tests/cronjob-core.test.ts`.
- [x] Accept 6-field cron expressions. Covered by `tests/cronjob-core.test.ts`.
- [x] Reject invalid timezones. Covered by `tests/cronjob-core.test.ts`.
- [x] Reject malformed cron expressions with too few fields. Covered by `tests/cronjob-core.test.ts`.
- [x] Prompt targets trim prompt text. Covered by `tests/cronjob-core.test.ts`.
- [x] Prompt targets default `allow_workflow_runs_without_permission` to true. Covered by `tests/cronjob-core.test.ts`.
- [x] Prompt targets preserve explicit `allow_workflow_runs_without_permission: false`. Covered by `tests/cronjob-core.test.ts`.
- [x] Prompt targets reject empty prompts. Covered by `tests/cronjob-core.test.ts`.
- [x] Invalid target types are rejected. Covered by `tests/cronjob-core.test.ts`.
- [x] Workflow targets default missing `workflow_inputs` to `{}`. Covered by `tests/cronjob-workflow-target-validation.test.ts`.
- [x] Workflow targets reject non-object `workflow_inputs`. Covered by `tests/cronjob-workflow-target-validation.test.ts`.
- [x] Workflow targets clear prompt-only fields. Covered by `tests/cronjob-workflow-target-validation.test.ts`.
- [x] Prompt targets clear workflow-only fields. Covered by `tests/cronjob-core.test.ts`.

## Cronjob REST API

- [x] Create prompt cronjob stores trimmed name, prompt, cron expression, and timezone. Covered by `tests/cronjob-routes.test.ts`.
- [x] Create prompt cronjob serializes `target`, `schedule`, `next_run_at`, and `is_running`. Covered by `tests/cronjob-routes.test.ts`.
- [x] Duplicate cronjob names for the same user return 409. Covered by `tests/cronjob-routes.test.ts`.
- [x] Invalid timezone returns 400. Covered by `tests/cronjob-routes.test.ts`.
- [x] Non-boolean `enabled` returns 400. Covered by `tests/cronjob-routes.test.ts`.
- [x] Patch preserves omitted fields. Covered by `tests/cronjob-routes.test.ts`.
- [x] List marks active runs and latest run snapshots. Covered by `tests/cronjob-routes.test.ts`.
- [x] Manual run rejects if a run is already active. Covered by `tests/cronjob-routes.test.ts`.
- [x] Stop marks running prompt cronjob runs failed. Covered by `tests/cronjob-routes.test.ts`.
- [x] Stop is idempotent for non-running runs. Covered by `tests/cronjob-routes.test.ts`.
- [x] Users cannot fetch another user's cronjob. Covered by `tests/cronjob-routes.test.ts`.
- [x] Run history serializes prompt snapshots. Covered by `tests/cronjob-routes.test.ts`.
- [x] Deleting non-running cronjobs cascades run history. Covered by `tests/cronjob-routes.test.ts`.
- [x] Deleting running cronjobs is rejected. Covered by `tests/cronjob-delete-route.test.ts`.
- [x] Enable and disable endpoints update schedule state and serialized `next_run_at`. Covered by `tests/cronjob-routes.test.ts`.
- [x] Missing cronjobs return 404 for get, patch, enable, disable, run-now, runs, stop. Covered by `tests/cronjob-routes.test.ts`.
- [x] Another user cannot list or stop another user's cronjob run. Covered by `tests/cronjob-routes.test.ts`.
- [x] Patch can switch prompt to workflow target and clear prompt fields. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Patch can switch workflow to prompt target and clear workflow fields. Covered by `tests/cronjob-workflow-target.test.ts`.

## Workflow Cronjobs

- [x] Create workflow cronjob stores workflow slug and input JSON. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Workflow cronjobs require workflow run permission. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Workflow run history prefers actual workflow run args over current cronjob config. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Deleting linked workflow runs cascades linked cronjob runs. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Patch workflow cronjob to prompt clears workflow fields. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Patch prompt cronjob to workflow validates workflow access and stores workflow input JSON. Covered by `tests/cronjob-workflow-target.test.ts`.
- [x] Scheduled workflow dispatch creates a cronjob run and links the workflow run id. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Workflow dispatch failure marks cronjob run failed. Covered by `tests/cronjob-dispatch.test.ts`.

## Prompt Cronjob Dispatch And Monitoring

- [x] Scheduled dispatch rejects disabled cronjobs. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Scheduled dispatch creates skipped run when previous run is active. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Manual dispatch creates a hidden chat session for prompt cronjobs. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Prompt dispatch sends runtime instructions with current time, available context marker, and cronjob task. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Prompt dispatch starts the monitor with a 1.5x interval timeout. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] Prompt dispatch marks run failed if OpenCode prompt send fails. Covered by `tests/cronjob-dispatch.test.ts`.
- [x] `complete-current` marks only running current cronjob run success. Covered by `tests/cronjob-completion-route.test.ts`.
- [x] `complete-current` rejects non-cronjob sessions. Covered by `tests/cronjob-completion-route.test.ts`.
- [x] `complete-current` rejects already completed runs. Covered by `tests/cronjob-completion-route.test.ts`.
- [x] `fail-current` marks only running current cronjob run failed with summary and error message. Covered by `tests/cronjob-completion-route.test.ts`.

## Stopping And Recovery

- [x] Startup reconciliation fails running cronjob runs. Covered by `tests/reconcile-running-crons-and-workflows.test.ts`.
- [x] Startup reconciliation fails running workflow runs. Covered by `tests/reconcile-running-crons-and-workflows.test.ts`.
- [x] Startup reconciliation leaves completed runs unchanged. Covered by `tests/reconcile-running-crons-and-workflows.test.ts`.
- [x] Stopping a workflow cronjob marks the linked workflow session aborted. Covered by `tests/cronjob-stop-helper.test.ts`.
- [x] Stopping a prompt cronjob aborts the OpenCode session and marks the run failed. Covered by `tests/cronjob-stop-helper.test.ts`.
- [x] Stopping an already terminal cronjob run is a no-op. Covered by `tests/cronjob-stop-helper.test.ts`.

## Chat Session Attention And First-Message Context

- [x] Pending question on latest assistant message marks attention. Covered by `tests/chat-session-pending-input.test.ts`.
- [x] Pending question on older assistant message does not mark attention. Covered by `tests/chat-session-pending-input.test.ts`.
- [x] Pending permission on latest assistant message marks attention. Covered by `tests/chat-session-pending-input.test.ts`.
- [x] Pending custom permission on latest assistant message marks attention. Covered by `tests/chat-session-pending-input.test.ts`.
- [x] Null latest assistant message does not mark attention. Covered by `tests/chat-session-pending-input.test.ts`.
- [x] Current time prompt includes local time, timezone, and UTC time. Covered by `tests/cronjob-core.test.ts`.
- [x] Normal chat first message injects current time context even when there are no skills/secrets/user instructions. Covered by `tests/chat-session-context-route.test.ts`.
- [x] Normal chat first message does not inject the context again after the first message. Covered by `tests/chat-session-context-route.test.ts`.
- [x] Idle sessions normalize stale running/pending tool parts to interrupted errors. Covered by `tests/chat-session-stale-tools.test.ts`.
- [x] Busy sessions leave running/pending tool parts unchanged. Covered by `tests/chat-session-stale-tools.test.ts`.

## OpenCode Cronjob Plugins

- [x] `listCronjobs` is read-only and does not request permission. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `createCronjob` requests permission before creating. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `editCronjob` requests permission before patching. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `runCronjobNow` requests permission before running. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] Rejected permission prevents run-now mutation. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `markCronjobCompleted` trims summary and calls complete endpoint. Covered by `tests/mark-cronjob-plugins.test.ts`.
- [x] `markCronjobFailed` trims summary and calls fail endpoint. Covered by `tests/mark-cronjob-plugins.test.ts`.
- [x] Mark plugins reject empty summaries without network calls. Covered by `tests/mark-cronjob-plugins.test.ts`.
- [x] Mark plugins surface API error messages. Covered by `tests/mark-cronjob-plugins.test.ts`.
- [x] `createCronjob` validates missing prompt before requesting permission. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `createCronjob` validates missing workflow slug before requesting permission. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `editCronjob` rejects empty patches before requesting permission. Covered by `tests/manage-cronjobs-plugin.test.ts`.
- [x] `runCronjobNow` validates missing id before requesting permission. Covered by `tests/manage-cronjobs-plugin.test.ts`.

## UI And Formatting Helpers

- [x] `formatRunActor` returns `Cronjob (user name)` for cronjob workflow runs. Covered by `tests/workflow-run-format.test.ts`.
- [x] `formatRunActor` returns fallback labels for user/API runs. Covered by `tests/workflow-run-format.test.ts`.
- [x] Cronjob past-run summary fallback returns "Summary of result not available" when summary is absent. Covered by `tests/cronjob-format.test.ts`.
