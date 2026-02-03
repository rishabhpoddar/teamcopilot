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
  -v flowpal-data:/app/data \
  -v flowpal-workspaces:/app/workspaces \
  -e DATABASE_URL="file:../data/flowpal.db" \
  -e API_URL="http://localhost:3000" \
  -e WEBSITE_URL="http://localhost:3000" \
  -e JWT_SECRET="change-me-in-production" \
  flowpal
```

The application will be available at **http://localhost:3000**

### Docker Volumes

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `flowpal-data` | `/app/data` | SQLite database file |
| `flowpal-workspaces` | `/app/workspaces` | User workflow storage |

Data is persisted in Docker named volumes. Even if you remove and recreate the container, your database and workspaces are retained.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `file:./dev.db` |
| `API_URL` | Backend API URL | `http://localhost:3000` |
| `WEBSITE_URL` | Frontend URL | `http://localhost:3000` |
| `JWT_SECRET` | Secret for JWT tokens | (required) |

> Note: `DATABASE_URL` is relative to the `prisma/` directory. For Docker, the default is overridden to `file:../data/flowpal.db` so the database lives in a separate mountable directory.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and database management.

## License

[Add your license here]
