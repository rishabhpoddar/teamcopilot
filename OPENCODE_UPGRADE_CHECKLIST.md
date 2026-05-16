# OpenCode Upgrade Checklist

Use this whenever changing `opencode-ai`, `@opencode-ai/sdk`, `@opencode-ai/plugin`, OpenCode provider packages, or the workspace `.opencode` plugin runtime.

## Upstream Source Audit

- [ ] Compare against the exact upstream tag being adopted, not `dev`.
- [ ] Review `packages/opencode/src/tool/registry.ts` for added, removed, renamed, gated, or model-filtered tools.
- [ ] Review `packages/opencode/src/tool/edit.ts`, `write.ts`, `apply_patch.ts`, `bash.ts`, `batch.ts`, `lsp.ts`, and `todo.ts`.
- [ ] Review `packages/opencode/src/plugin/*` or plugin hook types for changes to hook names, hook ordering, `input`, `output`, `ToolContext`, and custom tool return values.
- [ ] Review SDK generated types for `Session`, `Find`, `Provider`, message parts, tool states, permissions, and session status.
- [ ] Review server startup API changes for `createOpencodeServer()` and client API changes for `createOpencodeClient()`.

## Version Pins And Workspace Bootstrap

- [ ] Update root dependencies in `package.json`: `opencode-ai` and `@opencode-ai/sdk`.
- [ ] Update workspace package generation in `src/utils/workspace-sync.ts`, including the hardcoded `opencode-ai` version and provider package versions.
- [ ] Update `src/workspace_files/package.json` and `src/workspace_files/package-lock.json`.
- [ ] Update `.opencode` plugin runtime pins in `src/workspace_files/.opencode/package.json` and `src/workspace_files/.opencode/package-lock.json`, especially `@opencode-ai/plugin`.
- [ ] Recompute `src/workspace_files/.opencode/install-state.json` only if the expected workspace install hash legitimately changed.
- [ ] Check `.env.example` for changed `OPENCODE_MODEL`, provider, or auth environment requirements.

## Backend OpenCode API Surface

- [ ] `src/opencode-server.ts`: `createOpencodeServer()`, `hostname`, `port`, `config.model`, `config.tools.skill`, `autoupdate`, close semantics, and port-kill retry behavior.
- [ ] `src/utils/opencode-client.ts`: `createOpencodeClient({ baseUrl, directory })`, `OPENCODE_PORT`, workspace directory resolution, and direct HTTP calls to `/question` and `/permission`.
- [ ] `src/opencode-auth/index.ts`: `/provider/auth`, `/provider/:id/oauth/authorize`, `/provider/:id/oauth/callback`, provider auth response shape, OAuth method indexing, and error bodies.
- [ ] `src/utils/opencode-auth.ts`: `XDG_DATA_HOME`, runtime `auth.json`, workspace `.opencode/opencode.json`, Azure provider config, Google Vertex provider config, and service-managed provider detection.
- [ ] `src/chat/index.ts`: `session.list`, `session.status`, `find.files`, `session.create`, `session.get`, `session.delete`, `session.messages`, `session.promptAsync`, pending questions, pending permissions, file attachments, and first-message prompt injection.
- [ ] `src/cronjobs/scheduler.ts`: prompt cronjob `session.create`, `session.promptAsync`, `session.status`, idle detection, continuation prompts, timeout failure, and recovery on process restart.
- [ ] `src/utils/session-abort.ts`: pending question replies, pending permission rejects, custom permission cleanup, and `session.abort`.
- [ ] `src/utils/chat-usage.ts`: `session.messages()` shape, assistant `tokens`, `providerID`, `modelID`, `time.completed`, and last-synced message behavior.
- [ ] `src/utils/chat-session.ts`: message part types, tool state statuses, pending input detection, and stale running tool normalization.

## OpenCode Message And Permission Shapes

- [ ] Confirm `SessionStatusMap` still maps session id to `{ type: "busy" | "retry" | "idle" }`.
- [ ] Confirm message containers still look like `{ info, parts }` for `session.messages()`.
- [ ] Confirm `ToolPart` still has `tool`, `callID`, `messageID`, and `state.status`.
- [ ] Confirm tool states still use `pending`, `running`, `completed`, and `error`.
- [ ] Confirm pending questions still expose `id`, `sessionID`, `questions`, and optional `tool.messageID` / `tool.callID`.
- [ ] Confirm pending permissions still expose `id`, `sessionID`, `permission`, `patterns`, `metadata`, `always`, and optional `tool.messageID` / `tool.callID`.
- [ ] Confirm permission replies still accept `once`, `always`, and `reject`.

## File Edit And Session Diff Tracking

Current TeamCopilot diff tracking supports:

- `apply_patch`: parses `*** Begin Patch` payloads and tracks add, update, delete, and move targets.
- `write`: tracks `filePath` / `filepath`.
- `edit`: tracks `filePath` / `filepath`.
- `bash`: best-effort tracking for deleted files from `rm`.

Required checks:

- [ ] Confirm upstream `edit` still uses `filePath`, `oldString`, `newString`, and optional `replaceAll`.
- [ ] Confirm upstream `write` still uses `filePath` and `content`.
- [ ] Confirm upstream `apply_patch` still emits parseable patch text and supports add, update, delete, and move headers.
- [ ] Confirm upstream model filtering still uses either `apply_patch` or `edit`/`write` depending on model, and update tests for any new model-specific behavior.
- [ ] Confirm `src/workspace_files/.opencode/plugins/apply-patch-session-diff.ts` allowlists every file-writing built-in tool.
- [ ] Confirm `tool.execute.before` still runs before file mutation and still receives both `input.args` and `output.args`.
- [ ] Confirm root session resolution still works when OpenCode creates child sessions or tasks.
- [ ] Confirm `src/chat/index.ts` `/api/chat/sessions/file-diff/capture-baseline` still accepts the bearer token session id used by plugins.
- [ ] Confirm `frontend/src/components/dashboard/chat/SessionFileDiffPanel.tsx` still renders added, modified, deleted, binary, and ignored-file cases correctly.

Known risky areas:

- [ ] `bash` can mutate files through `cp`, `mv`, `mkdir`, `touch`, redirection, `sed -i`, scripts, and many other commands; current diff tracking only handles `rm` deletes.
- [ ] Upstream `batch` is experimental in v1.3.7 and can execute nested tools. If enabled, verify nested `edit`, `write`, or `apply_patch` calls trigger our hook; otherwise add explicit `batch` parsing or disable it.
- [ ] Upstream `PatchPart` includes `files`; if OpenCode changes tool hooks, consider using patch/message parts as a secondary source for changed paths.
- [ ] `lsp` and `todowrite` are not workspace file-edit tools in v1.3.7, but still review them for any new file mutation on upgrade.

## Workspace Plugin Contracts

- [ ] `apply-patch-session-diff.ts`: `tool.execute.before`, `client.session.get`, `session.parentID`, `directory`, tool arg shapes, and backend fetch to `/api/chat/sessions/file-diff/capture-baseline`.
- [ ] `secret-proxy.ts`: `command.execute.before`, `tool.execute.before`, `shell.env`, `sessionID`, `callID`, mutable `input.arguments`, mutable `input.args` / `output.args`, and backend secret resolution.
- [ ] `python-protection.ts`: `command.execute.before`, `tool.execute.before`, `command`, `arguments`, `workdir`, `cwd`, `directory`, and `worktree`.
- [ ] `honeytoken-protection.ts`: `tool.execute.before`, `tool.execute.after`, output shape, metadata shape, title shape, and input args visibility.
- [ ] `skill-command-guard.ts`: `tool.execute.before`, `task` tool id, `command` arg shape, root session resolution, and backend skill metadata response.
- [ ] Custom tools in `.opencode/plugins/*.ts`: `tool()` definition shape, `execute(args, context)`, return type, `context.sessionID`, `context.messageID`, `context.callID`, `context.ask`, `context.metadata`, and backend fetch behavior.

## Custom TeamCopilot Tools To Smoke Test

- [ ] `runWorkflow`
- [ ] `createWorkflow`
- [ ] `createSkill`
- [ ] `findSkill`
- [ ] `getSkillContent`
- [ ] `findSimilarWorkflow`
- [ ] `listAvailableSkills`
- [ ] `listAvailableWorkflows`
- [ ] `listAvailableSecretKeys`
- [ ] `askCronjobUser`
- [ ] `manageCronjobs`: `listCronjobs`, `createCronjob`, `editCronjob`, `runCronjobNow`
- [ ] `manageCronjobTodos`: `addCronjobTodos`, `clearCronjobTodos`, `getCurrentCronjobTodo`, `getCronjobTodos`, `finishCurrentCronjobTodo`
- [ ] `markCronjobCompleted`
- [ ] `markCronjobFailed`

## Frontend And User Flows

- [ ] `frontend/src/types/chat.ts`: OpenCode message, part, and tool state types.
- [ ] `frontend/src/components/dashboard/chat/ToolCallDisplay.tsx`: tool input/output rendering, diff rendering, completed/error/pending/running states.
- [ ] `frontend/src/components/dashboard/chat/MessagePart.tsx`: text, reasoning, file, tool, step, and agent part rendering.
- [ ] `frontend/src/components/dashboard/chat/ChatContainer.tsx`: sessions, messages, pending permission responses, tool answers, abort, usage sync, SSE, and session diff loading.
- [ ] `frontend/src/pages/OpencodeAuthSetup.tsx` and `frontend/src/App.tsx`: provider credential status and auth setup flow.

## Manual Upgrade Smoke Tests

- [ ] Start the backend and confirm OpenCode server boot logs show the expected version/model/provider.
- [ ] Create a normal chat session and send a message.
- [ ] Attach a workspace file to a prompt and confirm OpenCode receives it.
- [ ] Use file suggestions via `@` mention search.
- [ ] Trigger `edit`, `write`, `apply_patch`, and `bash rm`; confirm session diff catches each path.
- [ ] Try a file mutation through `bash` that is not `rm`; confirm expected limitations are understood or add tracking.
- [ ] Trigger a native OpenCode permission prompt and approve/reject it.
- [ ] Trigger a custom TeamCopilot permission prompt and approve/reject it.
- [ ] Run a prompt cronjob through planning, todo execution, user attention, resume, completion, and failure.
- [ ] Run a workflow via `runWorkflow`.
- [ ] Verify secret placeholder rewriting in shell commands without exposing plaintext in model-visible output.
- [ ] Abort an active session and verify pending questions/permissions are cleaned up.
- [ ] Sync usage and confirm token/cost rows are updated.
- [ ] Verify OpenCode auth setup for API key, OAuth if supported, Azure, and Google Vertex.

## Regression Tests To Run

- [ ] `npm test -- tests/apply-patch-session-diff.test.ts`
- [ ] `npm test -- tests/secret-proxy-plugin.test.ts`
- [ ] `npm test -- tests/python-protection.test.ts`
- [ ] `npm test -- tests/skill-command-guard.test.ts`
- [ ] `npm test -- tests/run-workflow-plugin.test.ts`
- [ ] `npm test -- tests/create-skill-plugin.test.ts`
- [ ] `npm test -- tests/manage-cronjobs-plugin.test.ts`
- [ ] `npm test -- tests/manage-cronjob-todos-plugin.test.ts`
- [ ] `npm test -- tests/chat-session-context-route.test.ts`
- [ ] `npm test -- tests/chat-session-file-diff-route.test.ts`
- [ ] `npm test -- tests/chat-session-stale-tools.test.ts`
- [ ] `npm test -- tests/cronjob-dispatch.test.ts`
- [ ] `npm test -- tests/cronjob-chat-handoff-resume.test.ts`
- [ ] `npm test`
