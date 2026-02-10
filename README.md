# FlowPal

An open-source platform for running AI agent workflows on your local machine. FlowPal provides a web interface to create, manage, and execute automated workflows powered by AI agents.

## Features

- Local SQLite database for data persistence
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
git clone https://github.com/rishabhpoddar/flowpal
cd flowpal

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Configure environment
cp .env.example .env

# Set up database and build frontend
npx prisma migrate dev
cd frontend && npm run build && cd ..

# Start the server
npm start
```

The application will be available at **http://localhost:3000**

---

## Running With Docker

### Prerequisites
- Docker

### Setup

```bash
git clone https://github.com/rishabhpoddar/flowpal
cd flowpal

# Build the image
docker build -t flowpal .

# Run the container
docker run -d \
  --name flowpal \
  -p 3000:3000 \
  -v db-data:/app/data \
  -v my_workspaces:/app/workspaces \
  -e SERVICE_URL="http://localhost:3000" \
  -e JWT_SECRET="your-secret-key" \
  flowpal
```

The application will be available at **http://localhost:3000**

### Docker Volumes

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `db-data` | `/app/data` | SQLite database file |
| `my_workspaces` | `/app/workspaces` | User workflow storage |

Data is persisted in Docker named volumes. Even if you remove and recreate the container, your database and workspaces are retained.

---

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SERVICE_URL` | URL where the service is accessible |
| `JWT_SECRET` | Secret for JWT tokens |
| `DATABASE_URL` | SQLite database path |
| `WORKSPACE_DIR` | Path to workspace directory |

> Note: `DATABASE_URL` is relative to the `prisma/` directory. For Docker, `DATABASE_URL` and `WORKSPACE_DIR` are set automatically in the image.

---

## User Management

### Creating an Account

Visit the application in your browser and click **Sign Up**. You'll need to provide a name, email, and password (minimum 8 characters).

### Signing In

Visit `/login` and enter your email and password.

### Resetting a Password

Password reset is done via a CLI command on the server. There is no email-based reset flow.

1. Run the reset command with the user's email:
   ```bash
   npm run reset-password -- user@example.com
   ```
2. This prints a one-time reset link to the console (valid for 1 hour).
3. Open the link in a browser and set a new password.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and database management.

## License

MIT License
