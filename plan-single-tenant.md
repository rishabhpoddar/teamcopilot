# FlowPal (Open Source) — Single-Tenant Self-Hosted Architecture

## Executive Summary

FlowPal OSS is a **single-tenant, self-hosted** application that lets a team define and execute programmatic workflows using AI. Users describe what they want in natural language, and a **single agent** (with access to a workspace filesystem + shell) can create, update, and run workflows directly inside that workspace.

This document describes the architecture and operational model for an **open-source distribution** where users host **one isolated instance (frontend + backend)** on their own infrastructure.

**Non-goals (for OSS single-tenant):**
- Multi-tenant SaaS concerns (tenant isolation, billing, per-tenant namespaces)
- Cross-customer data separation (each installation is one tenant)
- Hosted ops/runbooks provided by FlowPal (operators own infra + security decisions)

---

## 1. High-Level Architecture

```
                     +---------------------------+
                     |   FlowPal Web (Next.js)  |
                     |   UI + Admin Console     |
                     +-------------+-------------+
                                   |
                                   v
                     +-------------+-------------+
                     |        Backend API        |
                     |     (Bun + Hono TS)       |
                     +------+------+-------------+
                            |      |
                            |      +--------------------+
                            |                           |
                            v                           v
                +-----------+-----------+     +---------+---------+
                |     PostgreSQL        |     |     Redis/Queue   |
                |   (pgvector optional) |     |   (BullMQ)        |
                +-----------+-----------+     +---------+---------+
                            |                           |
                            v                           v
                +-----------+-----------+     +---------+---------+
                | Workspace Filesystem  |<--->| Execution Worker  |
                | (workflows + runs)    |     | (runs workflows)  |
                +-----------+-----------+     +---------+---------+
                            |
                            v
                +-----------+-----------+
                |  Sandbox Runtime      |
                |  (gVisor/Firecracker) |
                +-----------------------+
```

**Key property:** the filesystem workspace is the **source of truth** for workflows. The database stores metadata (workflows index, versions, runs, audit logs, users), while the workflow content lives in folders.

---

## 2. Core Components

### 2.1 Single-Tenant Model

FlowPal OSS assumes:
- One installation belongs to one organization/team.
- You may have **multiple users** inside the instance (RBAC), but they all share the same tenant and workspace.
- All data is scoped to the instance; there is no tenant_id column requirement.

**User roles (suggested):**
- **Admin**: manage instance settings, users, credentials policy, and approvals
- **Engineer**: review/approve workflows, edit workflow code, manage integrations
- **User**: request workflows, trigger runs, view outputs subject to permissions

> You can simplify further (single “owner” role) for early OSS releases; the rest of the doc still applies.

### 2.2 Single-Agent Architecture (Filesystem-First)

FlowPal uses **one agent** that has:
- a **workspace filesystem** (containing all workflows in folders)
- the ability to run **shell commands** inside that workspace

This is intentionally simple: the agent can discover existing workflows by listing folders, decide whether to create a new workflow vs run an existing one, and implement changes by editing files.

**Important implication:** if the agent has filesystem + shell access, then any secrets present in that workspace are accessible to the agent. This plan treats credential security as an **operator choice**:
- **Simplest (default)**: credentials live in per-workflow `.env` files (human-managed)
- **Recommended (production)**: credentials are stored outside the workspace (Vault/KMS/Secrets Manager) and injected at run time with scoped tokens or via internal proxy endpoints

### 2.3 Workflow System

**Features:**
- Natural language to code generation
- Version control for workflows
- **Approval gate for newly created workflows**
- Similarity search for reuse (optional; uses pgvector embeddings)
- Execution history and audit logs

#### Workflow Lifecycle

**Workflow version states (simplified):**
- **pending**: awaiting engineer/admin review (not executable)
- **approved**: executable (manual, scheduled, webhook triggers)
- **rejected**: not executable; retains review notes

**Versioning policy:**
- Editing workflow code/contract files (`run.py`, `workflow.json`, `README.md`, `requirements.txt`, `.env.example`) creates a **new immutable version** that returns to **pending**.
- Editing `data/` does **not** create a new version (data is mutable by design).
- Editing `.env` is a local operational change and is never versioned/approved by FlowPal.

#### Workflow Package Structure

Each workflow is a folder in the workspace. Workflows are **filesystem-first**: the folder contents are the source of truth.

```
Workspace
└── workflows/
    └── failed-stripe-payments/
        ├── workflow.json          ← Required: contract + runtime metadata
        ├── README.md              ← Required: docs + usage
        ├── run.py                 ← Required: entrypoint script
        ├── requirements.txt       ← Required: Python deps
        ├── .env                   ← Required (simplest): runtime config (human-managed; not committed)
        ├── .env.example           ← Recommended: documented template (committed)
        ├── .gitignore             ← Recommended: ignore `.env`, `.venv/`, `runs/`, etc.
        ├── .venv/                 ← Recommended: per-workflow virtualenv (local)
        ├── requirements.lock.txt  ← Recommended: pinned deps for reproducibility
        ├── data/                  ← Optional: non-secret config/state files
        ├── runs/                  ← Optional: run outputs/logs (local artifacts)
        ├── versions/              ← Optional: approved snapshots (immutable)
        └── tests/                 ← Optional: unit/integration tests
```

#### Workflow Contract (How the System Knows What a Workflow Does)

FlowPal does not attempt to parse arbitrary `run.py`. Instead, each workflow folder contains a small manifest in `workflow.json` that the UI and execution layer treat as the workflow’s contract:
- **`intent_summary`**: human-readable “what it does” summary
- **`inputs`**: required/optional inputs with types/defaults
- **`triggers`**: schedule/webhook/manual trigger configuration
- **`runtime`**: execution requirements (python version, timeout, retries)
- **`capabilities`**: declared external access needs (network, filesystem paths, etc.)

#### Workflow Conventions (Filesystem-First)

To keep self-hosting predictable:
- Workflows must be runnable from their folder with `python run.py` (or a wrapper the runner controls).
- Workflow outputs should be written to `runs/<run_id>/` (never overwrite global files).
- Never commit `.env` to source control; use `.env.example`.

### 2.4 Credential & Knowledge Management

FlowPal needs to handle two different “knowledge” categories:
- **Non-secret knowledge**: schemas, API docs, runbooks, internal URLs
- **Secrets**: API keys, tokens, passwords, private keys

**OSS default (simple):**
- `.env` per workflow contains secrets.
- FlowPal UI surfaces `.env.example` and instructions to operators.

**Production recommendation:**
- Secrets remain outside the workspace in your secret store.
- The execution worker fetches secrets at runtime and injects them into the sandbox (env vars) for that single run only.
- Access is audited.

### 2.5 Instance Context Model (Single Tenant)

Instead of “tenant context”, FlowPal OSS maintains:
- **Instance settings**: base URL, auth settings, LLM provider config, outbound email/webhooks configuration
- **Workspace config**: filesystem path/volume, retention policies, sandbox policy
- **Integrations registry**: configured connections (Stripe, Slack, etc.) and how workflows should access them

### 2.6 Agent Interaction Model

The agent should be able to:
- list and inspect workflow folders
- propose new workflows
- modify existing workflows (creates new pending version)
- request missing information from a human via the UI (if enabled)

For OSS, “ask an engineer” is implemented as:
- creating a UI task / notification for an Admin/Engineer
- optionally sending email/Slack if configured

### 2.7 Workflow Data Layer

Each workflow can store small bits of non-secret state/data in `data/` or via a backend-provided key/value interface. Minimal interface:

```python
# Read data (returns None if key doesn't exist)
value = flowpal.data.get("cursor")

# Write data
flowpal.data.set("cursor", "2026-01-31T00:00:00Z")

# Append to array data (best-effort)
flowpal.data.append("processed_ids", "evt_123")
```

Operators should treat workflow data as **application state** and back it up with the rest of the workspace volume.

### 2.8 Execution Environment

Workflows execute via a worker that:
- checks workflow version is **approved**
- provisions a sandbox (container/gVisor/Firecracker depending on policy)
- creates/uses a Python venv
- installs dependencies
- runs `run.py` with inputs
- captures logs + artifacts

**Sandbox choices:**
- **Simplest**: Docker container + Linux user isolation (fastest to ship, weakest boundary)
- **Recommended**: gVisor or Firecracker (stronger isolation for untrusted code)

### 2.9 Workflow Triggers & Inputs

Triggers:
- **manual** (from UI)
- **schedule** (cron-like)
- **webhook** (HTTP endpoint that maps to a workflow)

Inputs are passed into the run as JSON and made available through the runtime helper:

```python
inputs = flowpal.inputs()
customer_id = inputs.get("customer_id")
```

### 2.10 Error Handling & Retry

Per workflow runtime config:
- max retries
- retry backoff
- timeout

Retries must be careful with side effects; the workflow contract should document idempotency expectations.

---

## 3. AI Agent Tools (OSS Distribution)

The agent runtime typically needs:
- `fs`: read/write within workspace
- `shell`: run commands (venv, install deps, run workflow/tests)
- `http`: make outbound requests (optional; can be disabled globally)
- `ask_human`: create an approval/question task for Admin/Engineer

For self-hosting, operators should be able to configure which tools are enabled and their boundaries (e.g., allowed outbound domains, max runtime, filesystem allowlist).

---

## 4. User Interface & API

### How Users Interact with the Agent

**Chat interface:**
- users interact through a chat-like UI in the web app
- messages are sent to the agent
- the agent responds with status updates, questions, or completed workflows

**API endpoint (example):**
```
POST /api/chat
{
  "message": "Create a workflow that checks Stripe for failed payments daily",
  "workflow_id": null
}
```

**Response types:**
- `workflow_created`: new workflow generated, pending approval
- `workflow_updated`: existing workflow modified (new pending version)
- `question`: agent needs clarification
- `human_needed`: task created for Admin/Engineer, will resume when answered

**Workflow operations API (suggested):**
| Endpoint | Purpose |
|----------|---------|
| `POST /api/workflows` | Create workflow from natural language |
| `GET /api/workflows` | List workflows |
| `GET /api/workflows/{id}` | Get workflow details |
| `POST /api/workflows/{id}/run` | Trigger execution with optional inputs |
| `GET /api/workflows/{id}/runs` | List executions |
| `GET /api/runs/{id}` | Get execution details and logs |
| `POST /api/workflows/{id}/approve` | Approve pending version |
| `POST /api/workflows/{id}/reject` | Reject pending version |

---

## 5. Communication System (Self-Hosted)

### Human Question Flow (OSS)

When the agent needs information it doesn't have:
1. Agent identifies missing info (credentials, schema, API details)
2. Agent creates a question/task in the app addressed to Admin/Engineer
3. Optional notifications are sent (email/Slack/webhooks if configured)
4. Human answers (with optional “save to knowledge base”)
5. Agent resumes with the answer

### Workflow Approval Flow

1. User requests a new workflow in natural language
2. Agent creates/updates workflow files (`run.py`, `workflow.json`, `README.md`, `requirements.txt`, `.env.example`)
3. Workflow version is saved as **pending**
4. Admin/Engineer reviews and can **edit** workflow files
5. Admin/Engineer approves → version becomes **approved**
6. Triggers become active (schedule/webhook)
7. All actions are audited

### Real-Time Updates

Optional but recommended:
- WebSockets or SSE for live execution status
- progress indicators during workflow creation
- log streaming during execution

---

## 6. Tech Stack (Suggested Defaults)

### Backend
| Component | Technology |
|-----------|------------|
| API Framework | Hono (TypeScript) |
| Runtime | Bun |
| Database | PostgreSQL (pgvector optional) |
| Cache/Queue | Redis + BullMQ |
| Real-time | Socket.IO (or SSE) |
| Sandbox | gVisor/Firecracker (recommended) or Docker (simplest) |

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | Next.js 15 (App Router) |
| UI | shadcn/ui |
| State | TanStack Query |
| Code Editor | Monaco Editor |

### Infrastructure (Self-Hosted)
| Component | Options |
|-----------|---------|
| Reverse proxy | Nginx / Caddy / Traefik |
| TLS | Let’s Encrypt / internal PKI |
| Storage | Local disk / NAS / PVC (K8s) for workspace volume |
| Backups | Snapshot workspace + Postgres backups |
| Monitoring | Prometheus + Grafana (optional) |

---

## 7. Security Model (Self-Hosted Responsibilities)

FlowPal OSS provides guardrails, but **operators own the threat model** and must configure boundaries appropriately.

### Network Security
- terminate TLS at a reverse proxy
- rate limit sensitive endpoints (login, webhook triggers, chat)
- restrict inbound webhook endpoints with secrets/signatures

### Authentication & Authorization
- support local auth (email/password) or SSO (OIDC) depending on operator needs
- RBAC enforced server-side (Admin/Engineer/User)
- audit logs for approvals, edits, executions, and credential access

### Data Security
- database encryption-at-rest depends on your Postgres deployment
- workspace volume should be encrypted-at-rest when feasible
- ensure backups are protected (workspace + database)

### Credential Security
**Default (simple):**
- per-workflow `.env` files
- **note:** the agent can access them if it can read the workspace

**Recommended:**
- secrets stored externally (Vault/KMS)
- injected only at run time
- outbound network policy + domain allowlists

### Execution Security
- sandbox boundaries must reflect your risk tolerance
- enforce limits: CPU, memory, wall time, disk write size, outbound network
- consider an allowlist of installed base packages and/or a curated runner image

### AI Safety (Operator Controls)
- configure which LLM providers are allowed (and where prompts/data go)
- redact secrets in logs and UI
- provide a “dry run” / “plan only” mode for code generation if desired

---

## 8. Data Flow

### Creating a Workflow
1. user sends a chat request
2. backend calls agent runtime
3. agent inspects existing workflows for reuse
4. agent writes a new workflow folder or creates a new pending version
5. backend indexes metadata in Postgres (workflow list, versions)
6. UI shows “pending approval”

### Executing a Workflow
1. user triggers run (manual/scheduled/webhook)
2. backend enqueues run job in Redis/BullMQ
3. worker validates version is approved
4. worker provisions sandbox and mounts the workspace
5. worker runs `run.py` with inputs
6. logs and artifacts written to `runs/<run_id>/`
7. run metadata stored in Postgres; UI streams status/logs

---

## 9. UI/UX (OSS)

Minimum UI surfaces:
- chat screen (requests + agent updates)
- workflows list + detail page
- code viewer/editor for Admin/Engineer (with diff between versions)
- approvals queue (pending versions)
- runs page (status, logs, artifacts)
- instance settings (LLM provider config, notifications, security policy)

---

## 10. Implementation Phases (OSS-First)

### Phase 0 — Local Dev + Demo
- minimal backend API
- minimal UI
- local workspace folder
- run workflows without sandbox (local process)

### Phase 1 — “Self-Hosted MVP”
- docker-compose deployment
- Postgres + Redis
- approvals + versioning
- worker queue + run history

### Phase 2 — “Production-Ready Self-Hosting”
- sandbox isolation (gVisor/Firecracker)
- backups + retention policies
- OIDC SSO support (optional)
- observability hooks

---

## 11. Key Design Decisions

### Why a Single Agent with Full Workspace Control?
- aligns with filesystem-first workflows
- simplifies code generation and iteration
- makes workflows portable (folders can be copied/backed up)

### Why PostgreSQL?
- structured metadata + audit logs
- optional pgvector for similarity search
- mature self-hosting story

### Why a Separate Worker + Queue?
- isolates long-running/unsafe execution from the API
- supports retries and concurrency control
- makes deployments more predictable

---

## 12. Future Enhancements

- Dynamic UI layer for workflow inputs/outputs
- Workflow chaining / DAGs
- Long-running workflows with checkpoints
- More trigger types (event streams, inbox email, etc.)
- Policy engine for outbound network and credential access

---

## 13. Verification Plan (Self-Hosted)

Operators should validate:
- **backup/restore**: Postgres + workspace volume can be restored into a fresh install
- **upgrade path**: DB migrations are safe and reversible (or at least recoverable)
- **security**: sandbox limits enforced; webhook auth configured; secrets not exposed in UI/logs
- **reliability**: worker restarts do not lose jobs; runs are idempotent where needed

---

## 14. Critical Files to Implement First (Repo Layout Suggestion)

Backend:
- `apps/api/` (Hono routes, auth, workflows, runs)
- `apps/worker/` (queue consumer, sandbox runner)
- `packages/db/` (schema + migrations)
- `packages/agent/` (agent orchestration + tools)

Frontend:
- `apps/web/` (Next.js UI)

Infra (OSS):
- `docker-compose.yml`
- `deploy/helm/` (optional)
- `docs/self-hosting.md` (operator guide)

