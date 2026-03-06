# LocalTool

An open-source platform for running AI agent workflows on your local machine. LocalTool provides a web interface to create, manage, and execute automated workflows powered by AI agents.

## Features

- Local SQLite database for data persistence
- Workspace-scoped SQLite database (one DB per `WORKSPACE_DIR`)
- Web-based UI for workflow management
- Workspace-based workflow organization
- Python-based workflow execution

---

## Running Without Docker

### Prerequisites
- Node.js 20.x or later
- npm
- Python 3.10+ (for running workflows)

### Setup

```bash
git clone https://github.com/rishabhpoddar/localtool
cd localtool

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Configure environment
cp .env.example .env

# Build frontend
cd frontend && npm run build && cd ..

# Start the server
npm start
```

The application will be available at **http://localhost:5124**

Database migrations are applied automatically at server startup. If you point `WORKSPACE_DIR` to a new location, LocalTool creates a fresh SQLite database there.

### OpenCode Setup (Install + API Key)

LocalTool uses OpenCode. `npm install` in this repo already installs OpenCode locally via project dependencies, so you can use `npx opencode` directly.

1. Start OpenCode:
   ```bash
   npx opencode
   ```
2. In the OpenCode prompt, run:
   ```text
   /connect
   ```
3. Select your provider (or `opencode`), then create/copy your API key and paste it when prompted.

For provider-specific details, see the official docs: https://opencode.ai/docs

---

## Running With Docker

### Prerequisites
- Docker

### Setup

```bash
git clone https://github.com/rishabhpoddar/localtool
cd localtool

# Build the image
docker build -t localtool .

# Run the container
docker run -d \
  --name localtool \
  -p 5124:5124 \
  -v my_workspaces:/app/workspaces \
  -e EXTERNAL_SERVICE_URL="http://localhost:5124" \
  -e JWT_SECRET="your-secret-key" \
  localtool
```

The application will be available at **http://localhost:5124**

### Docker Volumes

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `my_workspaces` | `/app/workspaces` | User workflow storage and per-workspace SQLite database |

Data is persisted in Docker named volumes. Even if you remove and recreate the container, your workspace files and workspace-scoped database are retained.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXTERNAL_SERVICE_URL` | URL where the service is accessible | `http://localhost:5124` |
| `JWT_SECRET` | Secret for JWT tokens | - |
| `WORKSPACE_DIR` | Path to workspace directory | `./my_workspaces` |
| `HOST` | Hostname for the main server | `0.0.0.0` |
| `PORT` | Port for the main server | `5124` |
| `OPENCODE_PORT` | Port for the Opencode server | `4096` |
| `OPENCODE_MODEL` | AI model for Opencode | `openai/gpt-5.2-codex` |

> Note: SQLite database files are automatically managed inside `WORKSPACE_DIR/.sqlite` at `data.db`, and migrations are applied automatically at startup. `HOST` and `PORT` control the main HTTP server. `OPENCODE_PORT` is used internally by the backend process and normally does not need to be exposed with a Docker `-p` flag.

---

## User Management

### Creating an Account

Accounts are created via CLI on the server:

```bash
npm run create-user -- --email user@example.com --name "User Name" --role User --password "temporary-password"
```

On first sign-in with this temporary password, the user must set a new password before they can access the app.

### Updating a User's Role

```bash
npm run change-user-role -- --email user@example.com --role Engineer
```

### Deleting a User

```bash
npm run delete-user -- --email user@example.com
```

### Signing In

Visit `/login` and enter your email and password.

### Resetting a Password

Password reset is done via a CLI command on the server. There is no email-based reset flow.

1. Run the reset command with the user's email:
   ```bash
   npm run reset-password -- user@example.com
   ```
2. The CLI will prompt for a temporary password and store it.
3. The user must change their password on next sign in (same flow as first-time login).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and database management.

## License

MIT License
