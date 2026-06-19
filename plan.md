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
- MCP servers wrapped as approved skills when users want to add external tool capabilities.

This avoids a large provider-specific monitor framework while still allowing WhatsApp bots, log monitors, GitHub bots, internal APIs, polling jobs, and approval workflows.

## Component Minimization Rule

Default to the fewest components that can express the automation clearly:

- If an event starts in a hosted service, keep the logic in that service unless there is a strong reason to create a reusable finite workflow.
- Service handlers should be written to be idempotent and replay-friendly as far as possible, so a restarted process can pick up from the last completed step instead of duplicating work.
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

Do not introduce MCP as a separate platform primitive in every context.

MCP support should be expressed through skills. If a user asks to add an MCP server, the agent should create a skill package that contains the MCP server configuration, invocation instructions, required secrets, and usage examples. Once approved, the skill gives agents a controlled way to use that MCP capability without expanding the core automation model.

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

The current `target_type = "prompt"` path maps to the agent target. It should remain because it supports scheduled autonomous agent work, todo planning, hidden sessions, interrupting a user with a message, reveal-to-user, pause, resume, and final review.

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
  "public_path": "/services/whatsapp-listener",
  "required_secrets": ["WHATSAPP_WEBHOOK_SECRET", "WHATSAPP_ACCESS_TOKEN"]
}
```

TeamCopilot responsibilities:

- Start and stop.
- Capture logs.
- Inject declared secrets.
- Record each incoming event/request handled by a service-based flow as a durable request row with completed/incomplete status.
- Expose service HTTP routes through the existing `TEAMCOPILOT_PORT`; users should not need to open a new firewall port per service.
- Assign each running service a private Unix socket path on macOS/Linux and inject it as `TC_SERVICE_SOCKET`.
- Reverse-proxy `public_path` on the main TeamCopilot server to the service's Unix socket.
- Require approved code before start or public exposure.
- Stop running services when approved code changes.
- On server startup, automatically start every approved service that was already running before shutdown.
- On server startup, replay any incomplete service requests so event-driven flows continue from the last unfinished request instead of being dropped.

Service authors should listen for HTTP on the injected Unix socket. Public webhook URLs should always use the existing TeamCopilot origin:

```text
https://<teamcopilot-host>/services/<service-slug>/...
```

For local development, the same path should work on:

```text
http://localhost:<TEAMCOPILOT_PORT>/services/<service-slug>/...
```

This keeps the hosted service primitive powerful without requiring users to manage firewall rules, DNS records, external port allocations, or private TCP port conflicts. Windows service hosting is out of scope for v1.

Service process convention:

```text
TC_SERVICE_SOCKET=/path/to/teamcopilot/services/<service-slug>/service.sock
```

Example Python binding:

```python
import os
from waitress import serve

serve(app, unix_socket=os.environ["TC_SERVICE_SOCKET"])
```

V1 explicitly supports HTTP over Unix sockets. WebSockets, gRPC, HTTP/2, and raw TCP proxying are not required for the first version.

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

Workflows keep using args the same way they do today. If a workflow needs the user, it calls `tc.ask_user(instruction_to_agent, user_id, schema)` and blocks until the user replies with schema-valid structured data. If a workflow needs another workflow, it calls `tc.call_workflow(slug, args)` and blocks until that workflow finishes. If it needs an agent to do bounded work, it calls `tc.run_agent(instruction, schema)` and blocks until the agent returns schema-valid structured data.

This version does not add a separate workflow state file, file-path argument, or continuation args. The Python process keeps its local call stack while helper calls wait.

Every workflow run that invokes an agent must be visible in the UI, and users should be able to open the run at any time and inspect its full transcript, inputs, outputs, and intermediate messages.

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
tc.getSecretToken(key) -> { token: string | null, error: string | null }
tc.ask_user(instruction_to_agent, user_id, schema) -> AgentReply
tc.call_workflow(slug, args) -> result
tc.run_agent(instruction, schema) -> AgentReply
tc.append_message_to_chat(message, opencode_session_id, schema) -> AgentReply
tc.success(output)
tc.fail(error)
```

Runtime behavior:

- `tc.ask_user` works in workflows and services.
- `tc.getSecretToken` works in workflows and services and fetches the current value for a declared secret key on demand.
- `tc.call_workflow` works in workflows and services, but should only be used for a genuinely reusable finite automation boundary.
- `tc.run_agent` works in workflows and services, and is the clean way to ask an agent to do bounded work like PR review, research, classification, drafting, or investigation.
- `tc.append_message_to_chat` works in workflows and services, and lets the caller continue an existing OpenCode chat after `tc.ask_user` or `tc.run_agent` returns its `opencode_session_id`.
- `tc.success` and `tc.fail` are valid only inside workflow runs because only workflows have a terminal run result.
- In a hosted service request handler, normal Python/HTTP return values are used instead of `tc.success` and `tc.fail`.

This avoids separate `workflow.` and `service.` namespaces. The SDK can detect its runtime context from environment variables injected by TeamCopilot.

## MCP Support Through Skills

MCP should be supported as an adapter pattern, not as a new first-class automation primitive.

User request:

```text
Add this MCP and use it when working with Linear issues.
```

Agent behavior:

1. Inspect the MCP install instructions or package reference supplied by the user.
2. Create a draft skill under `.agents/skills/<slug>/`.
3. Write `SKILL.md` describing what the MCP can do, when to use it, and how to invoke it.
4. Add an MCP config file inside the skill package, for example `mcp.json`.
5. Declare required secrets in skill metadata using the existing secret placeholder model.
6. Add minimal smoke-test instructions or a test command when the MCP supports one.
7. Submit the skill for the normal approval flow before it becomes available to agents.

Example skill shape:

```text
.agents/skills/linear-mcp/
  SKILL.md
  mcp.json
  README.md
```

Example `mcp.json`:

```json
{
  "servers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@linear/mcp-server"],
      "env": {
        "LINEAR_API_KEY": "{{SECRET:LINEAR_API_KEY}}"
      }
    }
  }
}
```

The MCP server should not receive raw secret values in files. It should use the same secret placeholder mechanism as skills and agent shell commands. During execution, TeamCopilot resolves `{{SECRET:...}}` through the existing secret proxy. If the secret key is OAuth-backed, resolution goes through `tc.getSecretToken`/internal Nango behavior behind the scenes.

This gives users an easy instruction path:

```text
Add the GitHub MCP from this package and make it available to agents.
```

without making MCP visible in every workflow, service, cronjob, or SDK concept.

## Agent Prompt Injection

`tc.run_agent` and `tc.ask_user` should pass their instructions to the spawned/reused agent as system-prompt material, not as ordinary user chat messages.

Reason:

- These instructions are operational control instructions from the script.
- The agent should treat them as task authority, not as user-authored chat content.
- The instruction may include structured context, expected output schema, callback ids, approval ids, or resume instructions.
- The user-facing chat should stay focused on what the agent asks the human, not the full internal automation payload.

For `tc.run_agent`, the single `instruction` string should include everything the agent needs, and `schema` defines the exact structured output contract TeamCopilot must validate:

```python
review = tc.run_agent(f"""
Review this GitHub PR and return JSON findings.

Repository: acme/app
Pull request: 123
Changed files:
{changed_files_json}
""", schema={
    "type": "object",
    "required": ["summary", "approval_recommended", "findings"],
    "properties": {
        "summary": {"type": "string"},
        "approval_recommended": {"type": "boolean"},
        "findings": {"type": "array"},
    },
})
```

For `tc.ask_user`, `instruction_to_agent` should include everything the agent needs to ask the specific human, and `schema` defines the exact structured output contract TeamCopilot must validate:

```python
answer = tc.ask_user(
    f"""
    Ask the finance lead whether to approve this refund.

    Refund:
    {refund_json}

    """,
    user_id=finance_user_id,
    schema={
        "type": "object",
        "required": ["decision", "reason"],
        "properties": {
            "decision": {"type": "string", "enum": ["approve", "reject", "needs_changes"]},
            "reason": {"type": "string"},
        },
    },
)
```

TeamCopilot should wrap these into an agent system prompt with platform metadata such as request id, caller id, expected callback tool, and output schema.

TeamCopilot must validate the agent's final structured reply against `schema` before returning from `tc.run_agent` or `tc.ask_user`. If validation fails, TeamCopilot should send the validation error back into the same OpenCode session and ask the agent to produce a corrected reply. The SDK call should return only after a schema-valid `data` object is available, or after the retry policy fails with a structured error.

## Agent Reply Protocol

`tc.run_agent`, `tc.ask_user`, and `tc.append_message_to_chat` should all take a schema and return the same shape:

```ts
type AgentReply = {
  opencode_session_id: string;
  data: unknown;
};
```

Meaning:

- `opencode_session_id`: the OpenCode session that produced the reply.
- `data`: required structured JSON returned by the agent.

For `tc.run_agent`, `data` is the structured result requested by the caller.

For `tc.ask_user`, `data` is the structured answer returned by the agent after the user replies.

The agent must always return structured `data` to the workflow or service. Even when the caller only needs text, the result should still be wrapped in an object, for example:

```json
{
  "answer": "Use the revised customer reply.",
  "decision": "approved"
}
```

If the agent cannot produce the requested schema, it should return a structured failure object in `data`; the SDK call should not silently degrade to a plain string.

`tc.append_message_to_chat` appends a new message into an existing OpenCode session and waits for the agent's next schema-valid reply:

```python
reply = tc.ask_user(
    "Ask the finance lead whether to approve this refund.",
    user_id=finance_user_id,
    schema={
        "type": "object",
        "required": ["decision"],
        "properties": {"decision": {"type": "string"}},
    },
)

follow_up = tc.append_message_to_chat(
    message="Ask one follow-up question: what accounting category should this refund use?",
    opencode_session_id=reply["opencode_session_id"],
    schema={
        "type": "object",
        "required": ["accounting_category"],
        "properties": {"accounting_category": {"type": "string"}},
    },
)

category = follow_up["data"]["accounting_category"]
```

This makes the continuation explicit without adding workflow state arguments. Intermediate replies and linked session ids are still recorded in the DB for audit and cleanup.

## Tool Inventory

This is the reduced tool surface the platform should expose to agents and to the platform runtime. Keep tools generic where the behavior is the same across resource types, but keep separate creation and lifecycle tools where the platform needs different validation, approval prompts, or runtime behavior.

### Shared TeamCopilot SDK

- `tc.ask_user(instruction_to_agent: str, user_id: string, schema: object) -> AgentReply`
  Ask a specific user through the agent chat layer and block until their reply is available.
- `tc.run_agent(instruction: string, schema: object) -> AgentReply`
  Start a bounded agent task and return its structured result to the caller.
- `tc.append_message_to_chat(message: string, opencode_session_id: string, schema: object) -> AgentReply`
  Append a message to an existing OpenCode session and return the next agent reply.
- `tc.call_workflow(slug: string, args: object) -> object`
  Run a reusable finite workflow and block until it completes.
- `tc.success(output: unknown = null) -> void`
  End a workflow successfully with a structured output payload.
- `tc.fail(error: string) -> void`
  End a workflow as failed with a structured error.

### Existing OpenCode / UI Tools

- `question({ questions: Array<{ header: string; id: string; question: string; options: Array<{ label: string; description: string }> }> }) -> string[]`
  Existing general human-question tool used by normal agent sessions to ask one or more questions.
- `runWorkflow({ slug: string; inputs: Record<string, unknown> }) -> object`
  Existing tool used by agents to start an approved workflow from a chat session.
- `permission` prompt responses (`allow_once`, `allow_always`, `deny`)
  Existing OpenCode permission gating for restricted tool use; this is system-managed rather than a normal function call.

### Resource Discovery And Authoring Tools

- `search_resources({ kind: "workflow" | "skill" | "service" | "cronjob", query?: string }) -> Array<object>`
  List or semantically search existing resources with one tool instead of separate list/find tools per resource type.
- `getSkillContent({ slug: string }) -> object`
  Read the canonical `SKILL.md` content for a specific approved skill.
- `listAvailableSecretKeys() -> Array<string>`
  Return the secret keys the current user can reference when authoring workflows, services, or skills.
- `createWorkflow({ slug: string, intent_summary: string, inputs?: object, timeout_seconds?: number }) -> object`
  Create a new workflow package on disk with its manifest and entrypoint skeleton.
- `createHttpService({ slug: string, name: string, entrypoint: string, public_path?: string, required_secrets?: string[], description?: string }) -> object`
  Create a new hosted service package on disk with its manifest and code skeleton.
- `createSkill({ slug: string, description: string, content: string }) -> object`
  Create a new custom skill package when reusable instruction logic does not already exist.
- `createMcpSkill({ slug: string, description: string, mcp_config: object, skill_content: string, required_secrets?: string[] }) -> object`
  Create a draft skill package that wraps one or more MCP servers behind the normal skill approval and secret-placeholder model.

### Cronjob Management Tools

- `createCronjob({ name: string, enabled: boolean, target_type: "prompt" | "workflow", prompt?: string, workflow_slug?: string, workflow_inputs?: object, cron_expression: string, timezone: string }) -> object`
  Create and schedule a new cronjob, either prompt-based or workflow-based.
- `editCronjob({ cronjob_id: string, ...updates }) -> object`
  Update an existing cronjob's schedule, prompt, workflow target, or enabled state.
- `runCronjobNow({ cronjob_id: string }) -> object`
  Trigger an existing cronjob immediately instead of waiting for its next scheduled run.

### Cronjob Runtime Tools

- `getCronjobTodos() -> { todo_list_version: number, current_todo_id: string | null, todos: Array<object> }`
  Fetch the active cronjob todo list, current todo id, and version token needed for safe edits.
- `updateCronjobTodos({ todo_list_version: number, operations: Array<object> }) -> { todo_list_version: number, current_todo_id: string | null, todos: Array<object> }`
  Apply todo insert, clear, reorder, or content update operations in one version-checked call.
- `finishCurrentCronjobTodo({ completionSummary: string }) -> { success: true, todo_list_version: number }`
  Mark the current cronjob todo as completed and advance the todo list.
- `markCronjobCompleted({ summary: string }) -> { success: true }`
  Mark the cronjob run as fully complete after every todo is done.
- `markCronjobFailed({ summary: string }) -> { success: true }`
  Mark the cronjob run as failed when it cannot continue.
- `askCronjobUser({message: string})`
  Reveals the chat to the user so that they can give inputs during the cronjob run.

### User And Human Reply Handoff Tools

- `answer_user_request({ request_id: string, data: unknown }) -> void`
  Send a user's reply back into a blocked workflow or service request so the waiting script can resume from the exact pause point.
- `askUser({ user_id: string, instruction_to_agent: string, schema: object }) -> { request_id: string, status: "pending" }`
  Agent-facing tool for any OpenCode agent session to ask another TeamCopilot user for structured input and block or resume the calling agent session when the answer is available.
- `getCurrentUser() -> { id: string, name: string, email: string, role: string, title: string | null, description: string | null }`
  Return the authenticated TeamCopilot user that is currently talking to the agent.
- `search_users({ query?: string }) -> Array<{ id: string, name: string, email: string, role: string, title: string | null, description: string | null }>`
  Search team members by name, email, role, title, and profile description so the agent can resolve the right person to ask.

### User Profiles

- Every user should have editable profile metadata for `title` and `description`.
- `title` should capture the user's role or job title, for example "Head of Support" or "Staff Infrastructure Engineer".
- `description` should capture what the user owns, knows, or is responsible for, for example "owns SAML/SCIM integrations and enterprise identity issues".
- Users can add this during signup or update it later from their profile screen.
- `search_users` should index and return these fields so agents can decide who is likely to know an answer or approve a request.

### Hosted Service Runtime Tools

- `startService({ service_slug: string }) -> object`
  Start an approved hosted service process and make it available to receive traffic.
- `stopService({ service_slug: string }) -> object`
  Stop a running hosted service process without deleting its files.
- `getServiceLogs({ service_slug: string, lines?: number }) -> Array<string> | string`
  Read recent logs for a hosted service so the agent can debug runtime behavior.

### Tool Reduction Rules

- Do not add separate list and search tools for each resource type; use `search_resources` with an optional query.
- Do not add `editService`; service edits are normal file edits to `services/<slug>/`.
- Do not add `restartService`; agents can call `stopService` and then `startService`.
- Do not add provider-specific tools like WhatsApp, Slack, GitHub, or Stripe helpers; those are normal code inside workflows or services.
- Do not add state APIs to the SDK; workflows and services use their `data/` directories directly.

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
""", user_id="user_123", schema={
    "type": "object",
    "required": ["answer"],
    "properties": {"answer": {"type": "string"}},
})

child_result = tc.call_workflow("classify-message", {
    "message": reply["data"]["answer"]
})

agent_result = tc.run_agent(
    "Review PR 123 in acme/app and return JSON findings.",
    schema={
        "type": "object",
        "required": ["findings"],
        "properties": {"findings": {"type": "array"}},
    },
)

tc.success({"ok": True})
tc.fail("Could not process request")
```

## Ask User

When a workflow or service calls `tc.ask_user`, TeamCopilot stores the instruction in the DB, opens or reuses an agent chat session for the specified user, and the SDK helper polls until the user replies.

OpenCode agent sessions need the same capability without forcing the caller to write explicit workflow branching. When the user asks an agent to do something like:

```text
Investigate this bug from the codebase, and ping Priya about it if necessary.
```

the agent should investigate with its normal tools, decide whether another human is needed, and call `askUser` only if needed. This applies to normal chat agents, cronjob agents, and agents spawned from `tc.run_agent`.

Suggested table:

```prisma
model automation_user_requests {
  id                   String @id @default(uuid())
  caller_type           String
  caller_id             String
  user_id              String
  status               String
  instruction_to_agent  String
  answer_data_json      Json?
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
answer_user_request({
  request_id: string;
  data: unknown;
})
```

The message sent to the agent should include the request id and explicitly instruct the agent to call `answer_user_request` after the user has answered. The agent must pass structured `data`.

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
  -> agent calls answer_user_request
  -> TeamCopilot stores structured data in automation_user_requests
  -> SDK helper polling sees the reply
  -> SDK helper returns AgentReply to the script
  -> script continues from the same stack frame
  -> TeamCopilot clears the intermediate reply after the caller finishes, or after a service request scope is complete
```

This preserves normal local Python variables and stack context. It is less restart-durable than the previous state-machine design, but it is much simpler for workflow authors.

Agent-session behavior:

```text
user or workflow asks agent to investigate and ping someone if necessary
  -> agent inspects files, runs commands, and forms a hypothesis
  -> agent decides whether another user is needed
  -> if not needed, agent answers in the same chat
  -> if needed, agent calls askUser with target user, instruction, and schema
  -> TeamCopilot creates automation_user_requests row with caller_type = "opencode_session"
  -> calling OpenCode session is marked waiting_for_user
  -> target user's agent chat asks the question
  -> target user replies
  -> target user's agent calls answer_user_request with structured data
  -> TeamCopilot appends the structured answer back into the calling OpenCode session
  -> original agent continues and returns its structured result or answers the original user
```

For agent sessions, `askUser` and `tc.ask_user` should share the same storage, validation, answer tool, and cleanup behavior. The difference is only the caller: `tc.ask_user` blocks a Python SDK helper, while `askUser` blocks or resumes an OpenCode agent session.

Intermediate user replies are runtime bookkeeping, not durable workflow output. They should be deleted after the workflow reaches `success` or `failed`, or after a service request scope completes.

## Hosted Services With Shared SDK

A webhook service can receive a request, do the work locally, ask a user when needed, run an agent when needed, and return an HTTP response. TeamCopilot should track whether each request completed; if the server restarts while a request is still incomplete, the service should replay that request before accepting it as done. The agent that builds the service should be instructed to make each step idempotent where possible and to resume from the last completed step as much as possible. It does not need to hand off to a workflow just because approval or agent work is needed.

Example:

```python
from teamcopilot import tc

@app.post("/webhook")
def webhook():
    event = parse_provider_payload(request)
    draft_reply = tc.run_agent(f"""
    Draft a customer-safe reply for this event.

    Event:
    {event}
    """, schema={
        "type": "object",
        "required": ["reply", "needs_approval"],
        "properties": {
            "reply": {"type": "string"},
            "needs_approval": {"type": "boolean"},
        },
    })
    draft = draft_reply["data"]
    approval = tc.ask_user(
        "Ask the support lead whether to send this reply: " + draft["reply"],
        user_id="user_support_lead",
        schema={
            "type": "object",
            "required": ["decision"],
            "properties": {"decision": {"type": "string", "enum": ["approve", "reject"]}},
        },
    )
    approval_data = approval["data"]
    if approval_data["decision"] == "approve":
        send_reply(event, draft["reply"])
    return {"ok": True, "approval": approval_data}
```

## Agent-Authored Automation

The AI agent composes these primitives.

It also needs a user lookup tool so it can resolve the `user_id` before writing a service or workflow that calls `tc.ask_user`.

Minimum agent-facing user tool:

- `search_users`: search users in TeamCopilot by name, email, role, title, and description, and return matching user ids.

For:

```text
When I get a new WhatsApp message, process it. If approval is needed, message me first.
```

The agent creates:

- `services/whatsapp-listener/` for the webhook.
- Service logic that calls `tc.run_agent` to draft or classify the reply.
- Service logic that calls `tc.ask_user` when approval is needed.
- Service logic that passes a configured `user_id` into `tc.ask_user`.
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
- Workflow logic that passes a configured `user_id` into `tc.ask_user`.
- Required secret declarations.

Agent-authored resources start as drafts. They become runnable only after validation, missing-secret checks, and approval.

For:

```text
Add this MCP server and use it whenever you need to search our issue tracker.
```

The agent creates:

- A draft skill under `.agents/skills/<slug>/`.
- `SKILL.md` instructions that explain when the MCP-backed capability should be used.
- `mcp.json` containing the MCP server command, args, and secret placeholders.
- Required secret declarations.
- Optional smoke-test instructions if the MCP package supports a harmless test.

After approval, agents can use the skill like any other custom skill. Workflows, services, and cronjobs do not need to know that the capability came from MCP.

## Approval And Safety

Use the existing resource approval snapshot model for:

```text
resource_kind = "service"
resource_kind = "workflow"
resource_kind = "cronjob"
```

Rules:

- Services use the same approval process as workflows before they can start or become publicly reachable.
- Services need approval before start or public routing.
- Workflows need approval before unattended execution.
- Cronjobs need approval before scheduled execution.
- Required secrets must be present before execution.
- Services and workflows can ask users either through script-level `tc.ask_user` or through agent-level `askUser` when the human handoff decision belongs inside a spawned agent session.
- Workflow runs that involve agents must remain inspectable in the UI after completion, with the full transcript preserved for later review.

## Runtime Secret Resolution

Services, workflows, and cronjobs should declare required secret keys in their manifest or database definition.

At runtime, TeamCopilot should resolve those keys from the creator's profile first, then fall back to global secrets. The script should fetch the token only when it needs it:

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
- `tc.getSecretToken` returns the resolved token or a structured error if the key is missing, revoked, or expired.
- Secret values should not be injected into the process environment for workflows or services.
- Secret values should not be written into prompts, logs, files, or resource definitions.

## OAuth Connections

OAuth is a separate secret-manager capability, not a property of workflows or services.

TeamCopilot should use Nango as an internal implementation detail for OAuth connection management. Users should never need to know that Nango exists, open a Nango dashboard, configure Nango directly, or think in terms of Nango connection ids.

Runtime ownership:

- TeamCopilot starts and supervises the internal Nango service during backend startup, similar to the embedded OpenCode server.
- TeamCopilot stores internal Nango settings in its own database or key-value table.
- TeamCopilot talks to Nango over a private local URL or socket.
- Nango stores and refreshes OAuth tokens.
- TeamCopilot owns all user-facing connection UI, provider setup UI, permission checks, audit records, and SDK behavior.

Users connect providers from the profile or global secrets UI through a button such as:

```text
Connect to service by signing in
```

Provider setup must also happen in TeamCopilot, not in Nango.

For each provider, an admin or user configures:

- Provider key, for example `slack`, `google`, or `github`.
- OAuth client id.
- OAuth client secret.
- Requested scopes.
- Whether the provider connection can be used as a user-scoped secret, global secret, or both.

The OAuth client id and client secret are stored in TeamCopilot secrets. They are not stored in workflows, services, prompts, or resource files.

Because TeamCopilot is self-hosted, the instance owner must create OAuth apps in each provider using their own TeamCopilot domain. TeamCopilot should show the exact redirect URL to paste into the provider dashboard:

```text
https://<teamcopilot-host>/api/oauth/callback/<provider>
```

The flow should work the same way across browser clients:

1. The user clicks the connect button for a specific provider and scope.
2. TeamCopilot creates a connection request and records the target secret key, provider, scope, user/global owner, and return location.
3. TeamCopilot asks the internal Nango service to create the provider authorization URL.
4. The browser is redirected to the provider consent screen.
5. The provider redirects back to a TeamCopilot callback URL.
6. TeamCopilot forwards the callback data to the internal Nango service so Nango can complete the code exchange.
7. Nango stores the access token, refresh token, expiry, and provider metadata internally.
8. TeamCopilot stores only TeamCopilot connection metadata under the selected secret key.
9. TeamCopilot redirects the browser back to the originating settings page and shows the connection as active.

Connection metadata shape:

```json
{
  "secret_key": "SLACK_CONNECTION",
  "type": "oauth_connection",
  "backend": "internal_nango",
  "provider": "slack",
  "connection_id": "user_123_slack",
  "scope": "user",
  "owner_user_id": "user_123",
  "status": "active"
}
```

For non-browser clients or automation flows:

- The client should surface a link or action that opens the same TeamCopilot connect flow in a browser.
- If a workflow or service calls `tc.getSecretToken` and the token is missing or expired, TeamCopilot should return a structured error that the caller can turn into a user-facing prompt or approval request.
- The actual OAuth consent always happens in the browser because the provider needs the user to sign in and grant access.

When a workflow or service calls `tc.getSecretToken` for an OAuth-backed key:

1. TeamCopilot resolves the key using the normal user-secret-first, global-secret-second rule.
2. TeamCopilot sees that the secret is an `oauth_connection`.
3. TeamCopilot asks internal Nango for a fresh access token for the stored provider and connection id.
4. TeamCopilot returns `{ token, error }` to the SDK.

Agents keep using the same `SECRET:...` placeholder path. If the placeholder points to an OAuth-backed key, TeamCopilot resolves it through internal Nango and injects the fresh access token through the existing secret-proxy mechanism.

If a provider is not already configured, the agent or user should create a provider setup draft in TeamCopilot. For standard OAuth2/OIDC providers, this should mostly be provider config data: authorization URL, token URL, scopes, client id secret key, and client secret secret key. If a provider has non-standard OAuth behavior, TeamCopilot may need a small provider adapter, but workflows and services still use only `tc.getSecretToken`.

This keeps token storage centralized while letting workflows, services, and agents request secrets by key without being tied to OAuth protocol details or Nango internals.

Example runtime usage:

```python
secret = tc.getSecretToken("WHATSAPP_ACCESS_TOKEN")
if secret["error"]:
    return {"ok": False, "error": secret["error"]}

access_token = secret["token"]
```

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

8. OAuth-backed connection

```text
user configures provider in TeamCopilot secret manager
  -> TeamCopilot shows redirect URL for the user's own domain
  -> user clicks "Connect to service by signing in"
  -> provider redirects back to TeamCopilot callback URL
  -> TeamCopilot completes the exchange through internal Nango
  -> workflow/service later calls tc.getSecretToken for the OAuth-backed key
```

Primitives used:

- TeamCopilot secret manager for provider setup and connection ownership.
- Internal Nango service for OAuth exchange, token storage, and token refresh.
- `tc.getSecretToken` for workflow/service access to a fresh token.
- Agent `SECRET:...` placeholder resolution for shell/tool access to the same connection.

Secret values and OAuth tokens should still live in TeamCopilot/Nango-managed stores, not resource-owned data files.

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
7. Add `answer_user_request` for agents to complete user requests.
8. Add `askUser` so OpenCode agents can request structured input from another TeamCopilot user.
9. Add `getCurrentUser` for the current authenticated user context.
10. Add editable user profile metadata for `title` and `description`.
11. Add `search_users` for agent-authored user targeting.
12. Add `search_resources` for workflow, skill, service, and cronjob discovery.
13. Add `createMcpSkill` so agents can wrap MCP servers as draft skills.
14. Add `cronjob_todo_templates` and migrate encoded prompt todos into structured rows.
15. Add distinct role/role metadata for agent cronjob chat messages.
16. Add hosted service resource loading from `services/<slug>/service.json`.
17. Add creator-scoped runtime secret resolution: user secret first, then global secret.
18. Add `tc.getSecretToken` for workflows/services and route agent `SECRET:...` placeholders through the same resolver.
19. Add internal Nango supervision plus TeamCopilot-owned OAuth provider setup and connection UI.
20. Add service process manager with manual start, stop, logs, approval checks, and Unix-socket setup.
21. Add reverse proxy routing from `TEAMCOPILOT_PORT` to approved service Unix sockets.
22. Let the agent search, create, and run services, workflows, cronjobs, and MCP-backed skills.

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
