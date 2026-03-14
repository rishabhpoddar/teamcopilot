# Contributing to TeamCopilot

## Development Setup

### Prerequisites

- Node.js 20+
- npm
- Python 3.10+

### Install dependencies

From the repo root:

```bash
npm install
cd frontend
npm install
cd ..
```

### Configure the environment

Create a local `.env` in the repo root:

```bash
cp .env.example .env
```

Default values in `.env.example`:

- `WORKSPACE_DIR=./my_workspaces`
- `TEAMCOPILOT_HOST=0.0.0.0`
- `TEAMCOPILOT_PORT=5124`
- `OPENCODE_PORT=4096`
- `OPENCODE_MODEL=openai/gpt-5.3-codex`

Adjust these if needed before starting the app.

### Run in development mode

Use the combined dev server for hot reload:

```bash
npm run dev
```

This starts:

- backend on `TEAMCOPILOT_PORT` from `.env` (default `5124`)
- frontend Vite dev server on `5173`

Open [http://localhost:5173](http://localhost:5173) for frontend development.

### Run backend or frontend separately

Backend only:

```bash
npm run dev:backend
```

Frontend only:

```bash
cd frontend
npm run dev
```

### Verify a production build locally

```bash
npm run build
npm start
```

Open [http://localhost:5124](http://localhost:5124) unless you changed the port in `.env`.

---

## Managing the Database

### View Database Contents

```bash
# Open Prisma Studio (visual database browser)
npm run prisma:studio
```

### Modify the Schema

1. Edit `prisma/schema.prisma`
2. Create and apply a migration:

```bash
npm run prisma:migrate:dev -- --name describe-your-changes
```

### Reset Database

```bash
# Warning: This deletes all data
npm run prisma:migrate:reset
```

---

## Releasing to npm

Use the root-level [release-teamcopilot-npm/SKILL.md](/Users/rishabhpoddar/Desktop/trythisapp/teamcopilot/release-teamcopilot-npm/SKILL.md) skill when preparing an npm release.

Example prompts:

```text
Use $release-teamcopilot-npm to dry-run the next npm release.
```

```text
Use $release-teamcopilot-npm to publish the current package.json version to npm, then create the matching GitHub release.
```

The skill enforces these release checks:

- `package.json` and `package-lock.json` versions must match
- `npm whoami` must return `trythisapp`
- `npm run test` must pass
- `npm run build` must pass
- `npm pack --json` must succeed

For the `trythisapp` npm account, the recommended release flow is a full dry run first, then a second publish step with `--skip-checks --otp <fresh-code>` so the TOTP code is still valid when `npm publish` runs.

After a successful npm publish, the skill also creates a GitHub tag matching the package version and uses `gh` to create the GitHub release notes from changes since the previous release.

---

## Troubleshooting

### Port Already in Use

```bash
lsof -ti:5124 | xargs kill -9
```

### Database Errors

```bash
# Reset and recreate the database
rm "$WORKSPACE_DIR/.sqlite/data.db"
npm run prisma:migrate:dev
```

### Frontend Not Loading

Make sure the frontend is built:

```bash
cd frontend
npm run build
```
