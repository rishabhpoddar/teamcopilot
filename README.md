<div align="center">
  <img src="frontend/public/logo.svg" alt="TeamCopilot Logo" width="220" align="middle" />
</div>

# TeamCopilot
TeamCopilot helps technical and non-technical teams become more productive by enabling safe sharing of custom AI agent skills and tools.

## What makes TeamCopilot different

It's like Claude code / OpenAI Codex, except that:
- Multi-user environment: everyone uses the same agent setup. Configure once, the whole team can use it.
- Skill & tool permissions: control who can use which skills and tools through the agent. Example: allow only certain people in the team to use a skill for making server config changes.
- Approval workflow: anyone can create tools/skills, but engineers in the team must approve them before the agent can even see them.
- Fully auditable: chat sessions can’t be deleted by users and are stored on your server.
- Use it anywhere: web UI lets you talk to the agent even when you're away from your work machine.
- You can pick either OpenAI or Anthropic as your AI provider.

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

This writes or updates a local `.env` in the current directory. `WORKSPACE_DIR` defaults to the current directory as an absolute path. You can also provide values up front:

```bash
npx teamcopilot init \
  --workspace-dir /absolute/path/to/workspace \
  --teamcopilot-port 5124 \
  --opencode-port 4096 \
  --opencode-model openai/gpt-5.3-codex
```

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

## Docker Setup

```bash
git clone https://github.com/rishabhpoddar/teamcopilot
cd teamcopilot
docker build -t teamcopilot .
docker run -d \
  --name teamcopilot \
  -p 5124:5124 \
  -v /path/to/some/folder:/app/workspaces \
  teamcopilot
```

Open: **http://localhost:5124**

## Common Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKSPACE_DIR` | Directory where workflows are stored | `./my_workspaces` |
| `TEAMCOPILOT_HOST` | Server host | `0.0.0.0` |
| `TEAMCOPILOT_PORT` | Server port | `5124` |
| `OPENCODE_PORT` | Internal OpenCode server port | `4096` |
| `OPENCODE_MODEL` | Model used by OpenCode | `openai/gpt-5.3-codex` |

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
