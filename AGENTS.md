# AGENTS.md

This file provides guidance to the agent when working with code in this repository.

## Project Overview

TeamCopilot is an open-source multi-user AI agent platform for teams that want shared agent capabilities without giving up control, visibility, or operational guardrails.

At a high level, TeamCopilot combines:
- a web UI for chatting with an agent remotely
- a shared filesystem-backed workspace of custom skills and workflows
- approval and permission controls for risky or reusable automation
- auditability for chat sessions and file changes
- team-oriented secret management for agent-assisted execution

## Repository Structure

This is a monorepo (without workspaces) containing:
- **Backend** (root): Express.js + TypeScript + Prisma + SQLite — lives in `src/`
- **Frontend** (`frontend/`): React 19 + TypeScript + Vite — separate `package.json`

The backend serves the built frontend from `frontend/dist/` as static files with SPA fallback routing.

## Commands

### Backend (run from repo root)
```bash
npm run dev              # Dev server with auto-reload (ts-node-dev)
npm run build            # Compile TypeScript to dist/
npm start                # Build + run (tsc && node dist/index.js)
```

### Frontend (run from frontend/)
```bash
npm run dev              # Vite dev server with HMR
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm run preview          # Preview production build
```

### Database (Prisma, run from repo root)
```bash
npm run prisma:migrate:dev -- --name <description>   # Create and apply migration
npm run prisma:migrate:reset                          # Reset database (deletes all data)
npm run prisma:migrate:deploy                         # Deploy migrations
npm run prisma:studio                                 # Visual database browser
```

### Initial Setup
```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env     # Then fill in values
cd frontend && npm run build && cd ..
```

## Architecture

### Backend API Pattern

All authenticated/versioned API routes use the `apiHandler` wrapper from `src/utils.ts`:

```typescript
apiRouter.get("/endpoint", apiHandler(async (req, res) => {
    // req.userId, req.email, req.name available
}, true));
```

`apiHandler` handles: API version validation from the URL path, JWT token verification from `Authorization: Bearer` header, and user lookup from Prisma. The `CustomRequest` type extends Express Request with `version`, `userId`, `email`, and `name`.

### Authentication Flow

Email/password auth → JWT tokens (365-day expiry). The flow:
1. `POST /api/auth/signup` — creates user with bcrypt-hashed password, returns JWT
2. `POST /api/auth/signin` — validates credentials, returns JWT
3. Frontend stores token in localStorage and sends `Authorization: Bearer {token}` on subsequent requests
4. Password reset via CLI: `npm run reset-password -- user@example.com` sets a temporary password

### Route Structure

All API routes are mounted under `/api` via `apiRouter`.

Non-API `GET *` requests serve `frontend/dist/index.html` for client-side routing.

`src/index.ts` also exports `createApp()` so route-level tests can mount the Express app in-process without starting a separate server.

### Database

SQLite via Prisma ORM. Schema is at `prisma/schema.prisma`. The database now stores much more than just auth metadata, including users, permissions, approvals, chat/session data, and secret-management tables such as `user_secrets` and `global_secrets`. SQLite uses WAL mode for concurrency (configured in `src/prisma/client.ts`).

### Shared Workspace Model

TeamCopilot is filesystem-first:
- workflows live in `workflows/<slug>/`
- custom skills live in `.agents/skills/<slug>/`
- the filesystem contents are the source of truth for those resources

This means most resource creation, editing, approval diffs, and runtime behavior are driven by real files on disk rather than opaque database blobs.

### Secrets Model

TeamCopilot has two secret scopes:
- user secrets: private to a specific user
- global secrets: shared across the team and managed by engineers

Resolution order is:
1. current user's secret
2. global secret
3. missing

Important implementation details:
- workflows declare required secret keys in `workflow.json` under `required_secrets`
- workflow runs receive resolved secrets as environment variables at runtime
- skills declare required secret keys in `SKILL.md` frontmatter
- skills keep placeholder references like `{{SECRET:OPENAI_API_KEY}}` in file content rather than storing raw secret values
- agent-facing secret usage in shell goes through a secret-proxy model; plaintext secret values are not included in the LLM-visible context
- `.env` files are still redacted in editor/file APIs, but AI-authored workflows should rely on declared runtime secrets rather than workflow-local `.env` files

### Approvals And Runtime Boundaries

- Workflows and custom skills can require engineer approval before they are usable.
- Workflow execution must go through the platform runtime rather than direct shell execution of `run.py`.
- Approval diffs and chat session file diffs are part of the product’s audit trail and are intentionally inspectable.

### Logging

`src/logging.ts` provides `logInfo` and `logError`. Both use `console.log` and `console.error` respectively.

### Cron Jobs

`src/cronjob/index.ts` exports `startCronJobs()` which is called at server startup.

## Environment Variables

JWT secret is generated on first boot and stored in `key_value`. Rotate via `npm run rotate-jwt-secret`.
Optional: `WORKSPACE_DIR` (absolute path or relative to project root, default `./my_workspaces`)

### Server
- `TEAMCOPILOT_HOST` (default `0.0.0.0`) — Hostname for the main server
- `TEAMCOPILOT_PORT` (default `5124`) — Port for the main server

### Opencode Server
- `OPENCODE_PORT` (default `4096`) — Internal port used by the Opencode server started inside the backend process (always listens on localhost)
- `OPENCODE_MODEL` (default `openai/gpt-5.3-codex`) — AI model to use

## Design Direction

Per `plan-single-tenant.md`, TeamCopilot is evolving toward a more fully integrated multi-user agent platform with richer real-time communication and stronger operational controls. The current implementation already centers around:
- a filesystem-first workspace model
- embedded OpenCode-based agent execution
- approval and audit flows
- profile/global secret management with a secret-proxy approach

Workflows remain filesystem-first folder packages with `workflow.json` manifests, `run.py` entrypoints, and per-workflow `.venv`. AI-authored workflow secret handling should use `required_secrets` plus runtime injection rather than workflow-local `.env` files.

## Code style

### General
- Avoid too many conditional types. Be sure of the types before implementing. For example, if something cannot be undefined / null, then don't make it optional and don't use `| undefined` or `| null` in the type.
- IMPORTANT: DO NOT BE DEFENSIVE WHEN IMPLEMENTING CODE. BE SURE OF TYPES! Add asserts, and if things error out, we can debug the errors if they happen!
- When making prisma schema changes, the migration needs to be done via the prisma migration command. NOT via by manually creating the migration file.

### Frontend
#### Network calls
When making network calls, use the `axios` library. Specifically, use the `axiosInstance` from the `./frontend/src/utils.ts` file. Make sure to always handle errors from the network call:
- If it's a GET request, and it errors out, then show the error message to the user via the UI on the screen.
- Otherwise, show it via a toast notification using the react-toastify library.
This is an example for GET:
```
try {
    const response = await axiosInstance.get('/api/....', {
        headers: { Authorization: `Bearer ${token}` }
    });
    // handle success
} catch (err: unknown) {
    const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : '<Some error message>';
    setError(errorMessage);
} finally {
    //....
}
```
This is an example for NON-GET:
```
try {
    const response = await axiosInstance.post('/api/....', {...}, {
        headers: { Authorization: `Bearer ${token}` }
    });
    // handle success
} catch (err: unknown) {
    const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : '<Some error message>';
    toast.error(errorMessage);
} finally {
    //....
}
```

Make sure that if the call requires auth, you pass in the access token as an Authorization bearer token in the headers. To get the access token, use the `useAuth` hook from the `./frontend/src/lib/auth.tsx` file.

### Backend
#### Error responses
Instead of doing something like:
```
res.status(400).json({ error: 'status must be "running", "success", or "failed"' });
```

Do this:
```
throw {
    status: 400,
    message: 'status must be "running", "success", or "failed"'
};
```
- The error handler in `index.ts` will handle it in the correct way.
- This is applicable for all status codes other than 200 ones.

### Error handling
- Prefer throwing errors rather than silently handling them via return values like false or null.

## Communication

- When asking the user questions (especially for clarification), ask **just one question at a time**.
