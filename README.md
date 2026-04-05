<div align="center">
  <img src="frontend/public/logo.svg" alt="TeamCopilot Logo" width="220" align="middle" />
</div>

# TeamCopilot
[TeamCopilot](https://teamcopilot.ai) is a multi-user AI agent platform for teams that want the power of coding agents without giving up control, visibility, or shared operational context.

It combines:
- a web UI for chatting with an agent from anywhere
- a shared workspace of custom skills and workflows
- approval and permission controls for risky automation
- auditability for chat sessions and file changes
- profile and global secret management for agent-assisted execution

The result is a setup where teams can centralize agent capabilities once, reuse them across users, and still keep strong guardrails around what the agent is allowed to see and do.

## What makes TeamCopilot different

It's like Claude Code / Codex-style local agents, but adapted for team use:
- Shared environment: everyone works against the same workspace, skills, workflows, and guardrails.
- Permission-aware automation: decide who can view, edit, approve, and run specific skills and workflows.
- Approval gates: engineers can require approval before custom skills or workflows become executable.
- Auditable operation: chat sessions, tracked file diffs, and approval diffs are stored on your server.
- Remote access to a local agent: users can interact through the web UI even when they are not physically at the machine hosting TeamCopilot.
- Filesystem-first extensibility: workflows and skills live as real files and folders, not opaque database blobs.

## Why teams use it

TeamCopilot is designed for organizations where AI should be useful, but not ungoverned.

Typical use cases:
- internal engineering copilots with shared repo-specific skills
- ops or infra workflows that must be reviewed before use
- support or product teams that need curated agent tools without shell access
- organizations that want reusable automation but still need approval, ownership, and audit trails
- teams that want to package domain knowledge into installable, inspectable skills

## Core capabilities

### Shared skills and workflows

TeamCopilot supports two main building blocks:
- **Skills**: reusable agent capabilities for common team tasks
- **Workflows**: reusable automations that can be reviewed and run consistently

These can be created, edited, reviewed, approved, and reused across the team.

### Safe execution model

TeamCopilot adds multiple layers of control around agent execution:
- decide who can view, edit, approve, and run each resource
- review exactly what changed before new automations are trusted
- keep risky or high-impact operations behind approval gates
- inspect file diffs from chat sessions instead of guessing what the agent changed

### Secrets without exposing them to the LLM

TeamCopilot includes secret management designed for team use:
- the agent does not need to see plaintext secret values in order to use them
- TeamCopilot uses a secret proxy model so secrets stay outside the LLM context
- teams can store personal and shared credentials in one place without broadly exposing the actual values
- teammates can use approved capabilities that depend on secrets without needing direct access to those raw credentials

This gives teams a safer way to operationalize AI agents without turning the model itself into a secret holder. You can read more about the approach in the [secret proxy writeup](https://teamcopilot.ai/blog/ai-agent-secret-proxy).

### Approval and auditability

Every team eventually needs to answer:
- who created this automation?
- who approved it?
- what changed?
- what did the agent do?

TeamCopilot is built around those questions. It gives teams a clearer record of ownership, approvals, diffs, and agent activity over time.

## See docs
Visit the [documentation section on our website](https://teamcopilot.ai/docs) to see an extensive guide on how to setup and use TeamCopilot.

## Dashboard View

![TeamCopilot Dashboard](/assets/dashboard.webp)

## Quick Start (npm)

### Prerequisites

- Node.js 20+
- npm
- Python 3.10+

### 1) Initialize in the folder you want to use

```bash
npx teamcopilot init
```

This writes or updates a local `.env` in the current directory. `WORKSPACE_DIR` defaults to the current directory as an absolute path, which becomes the shared TeamCopilot workspace root.

### 2) Start the server

```bash
npx teamcopilot start
```

Open: **http://localhost:5124**

### 3) Run admin commands from the same directory

```bash
npx teamcopilot create-user
npx teamcopilot change-user-role
npx teamcopilot delete-user
npx teamcopilot reset-password
npx teamcopilot rotate-jwt-secret
```

If `.env` is missing or incomplete, TeamCopilot will ask you to run `npx teamcopilot init` first.

## How TeamCopilot is structured

At a high level:
- the backend runs the TeamCopilot server and the embedded OpenCode agent server
- the frontend provides the web UI for chat, browsing skills/workflows, approvals, and admin flows
- the workspace directory stores skills, workflows, and tracked filesystem state
- Prisma + SQLite store users, permissions, approval metadata, sessions, and secrets

This design keeps the platform simple to operate while still making the agent environment shared and inspectable.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKSPACE_DIR` | Directory where workflows are stored | `./my_workspaces` |
| `TEAMCOPILOT_HOST` | Server host | `0.0.0.0` |
| `TEAMCOPILOT_PORT` | Server port | `5124` |
| `OPENCODE_PORT` | Internal OpenCode server port | `4096` |
| `OPENCODE_MODEL` | Model used by OpenCode | `openai/gpt-5.3-codex` |

## Operational highlights

- Multi-user auth with roles for Users and Engineers
- Shared skills and workflows backed by the filesystem
- Approval flows for custom automations
- Permission controls for who can access which resources
- Profile and global secret management
- Chat session history and file-diff inspection
- Browser-based UI for day-to-day use
- Local deployment with simple npm-based setup

## User Management (CLI)

Create user:

```bash
npx teamcopilot create-user
```

Change user role:

```bash
npx teamcopilot change-user-role
```

Delete user:

```bash
npx teamcopilot delete-user
```

Reset password:

```bash
npx teamcopilot reset-password
```

Rotate JWT secret (invalidates existing tokens causing everyone to get logged out):

```bash
npx teamcopilot rotate-jwt-secret
```

Users sign in at `/login`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
