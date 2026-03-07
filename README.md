# TeamCopilot

TeamCopilot helps technical and non-technical teams become more productive by enabling safe sharing of custom AI agent skills and tools, that you specifically build for organization.

## What makes TeamCopilot different

It's like Claude code / OpenAI Codex, except that:
- The skills and tools you create can be used by anyone in your team as long as you give them permission to do so.
- It makes it easy for non technical people to use AI agents since they don't have to work with a CLI.
- It's fully open source.
- You can pick either OpenAI or Anthropic as your AI provider.

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- npm
- Python 3.10+

### 1) Install

```bash
git clone https://github.com/rishabhpoddar/teamcopilot
cd teamcopilot
npm install
cd frontend && npm install && cd ..
```

### 2) Configure

```bash
cp .env.example .env
```

Set at least:

```env
WORKSPACE_DIR=/path/to/some/folder
JWT_SECRET=your-strong-secret
```

### 3) Build and start

```bash
cd frontend && npm run build && cd ..
npm start
```

Open: **http://localhost:5124**

## Docker Setup

```bash
git clone https://github.com/rishabhpoddar/teamcopilot
cd teamcopilot
docker build -t teamcopilot .
docker run -d \
  --name teamcopilot \
  -p 5124:5124 \
  -v /path/to/some/folder:/app/workspaces \
  -e JWT_SECRET="your-secret-key" \
  teamcopilot
```

Open: **http://localhost:5124**

## Common Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret used for auth tokens | - |
| `WORKSPACE_DIR` | Directory where workflows are stored | `./my_workspaces` |
| `HOST` | Server host | `0.0.0.0` |
| `PORT` | Server port | `5124` |
| `OPENCODE_PORT` | Internal OpenCode server port | `4096` |
| `OPENCODE_MODEL` | Model used by OpenCode | `openai/gpt-5.2-codex` |

## User Management (CLI)

Create user:

```bash
npm run create-user
```

Change user role:

```bash
npm run change-user-role
```

Delete user:

```bash
npm run delete-user
```

Reset password:

```bash
npm run reset-password
```

Users sign in at `/login`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
