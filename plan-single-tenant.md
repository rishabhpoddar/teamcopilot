# FlowPal (Open Source) — Single-Tenant Self-Hosted Architecture

## Executive Summary

FlowPal OSS is a **single-tenant, self-hosted** application that lets a team define and execute programmatic workflows using AI with a deliberately simple architecture.

Users run an instance of **opencode** on their machine inside their project/workspace directory. That workspace contains:
- workflow folders (`workflows/<slug>/...`)
- a workspace-root instruction document for the agent (`AGENTS.md`)
- tool scripts (`./tools/*`)

FlowPal consists of just:
- a **Next.js frontend**
- a **Node.js backend**
- a **PostgreSQL database**
- a **VSCode-in-browser workspace viewer** accessible from the web app (for viewing the workspace directory)

**Communication model:**
- tool scripts (running in the workspace) call the **Node backend API**
- the **Node backend communicates with the opencode agent** (bi-directional) to pass user input, tool results, and status updates
- **opencode plugins** (like `askAnEngineer`) handle long-running async operations where results may take hours

This document describes the architecture and operational model for an **open-source distribution** where operators host **one isolated instance (frontend + backend + Postgres)**, while opencode runs on a user machine where the workspace lives.

**Non-goals (for OSS single-tenant):**
- Multi-tenant SaaS concerns (tenant isolation, billing, per-tenant namespaces)
- Cross-customer data separation (each installation is one tenant)
- Hosted ops/runbooks provided by FlowPal (operators own infra + security decisions)

---

## 1. High-Level Architecture

```
                      (Self-hosted single-tenant instance)
     +---------------------------+        +---------------------------+
     |   FlowPal Web (Next.js)   |<------>|     Node Backend API      |
     |   UI + Admin Console      |        | (auth, chat, routing)     |
     +-------------+-------------+        |  routing)                 |
                   |                      +-------------+-------------+
                   |                                    |
                   |                                    v
                   |                      +---------------------------+
                   |                      |        PostgreSQL         |
                   |                      | (metadata, runs,          |
                   |                      |  knowledge)               |
                   |                      +---------------------------+
                   |
                   | chat + events (WebSocket/SSE)
                   v
                    (User machine / Workspace)
     +--------------------------------------------------------------------+
     | Workspace directory                                                 |
     |  - `AGENTS.md` (agent instructions)                           |
     |  - `./tools/*` (scripts → call Node backend)                          |
     |  - `workflows/<slug>/...` (workflow folders)                         |
     |                                                                      |
     |  +----------------------+                                            |
     |  | opencode agent       |<----------- Node backend communicates ------|
     |  | (runs in workspace)  |            with agent (bi-directional)      |
     |  +----------------------+                                            |
     +--------------------------------------------------------------------+
```

**Key property:** the filesystem workspace is the **source of truth** for workflows. The database stores metadata (workflows index, runs, audit logs, users), while the workflow content lives in folders.

---

## 2. Core Components

### 2.1 Single-Tenant Model

FlowPal OSS assumes:
- One installation belongs to one organization/team.
- You may have **multiple users** inside the instance (RBAC), but they all share the same tenant and workspace.
- All data is scoped to the instance; there is no tenant_id column requirement.

**User roles (suggested):**
- **Admin**: manage instance settings, users, and credentials policy
- **Engineer**: edit workflow code, manage integrations
- **User**: request workflows, trigger runs, view outputs subject to permissions

> You can simplify further (single “owner” role) for early OSS releases; the rest of the doc still applies.

### 2.2 Single-Agent Architecture (Local opencode, Workspace-First)

FlowPal uses **one local agent** (opencode) that has:
- a **workspace filesystem** (your actual project directory; containing all workflows in folders)
- the ability to run **shell commands** inside that workspace
- a small set of **workspace-provided tool scripts** (see below)

This is intentionally simple: the agent can discover existing workflows by listing folders, decide whether to create a new workflow vs run an existing one, and implement changes by editing files.

**Important implication:** if the agent has filesystem + shell access, then any secrets present in that workspace are accessible to the agent. This plan treats credential security as an **operator choice**:
- **Simplest (default)**: credentials live in per-workflow `.env` files (human-managed)
- **Recommended (production)**: credentials are stored outside the workspace (Vault/KMS/Secrets Manager) and injected at run time with scoped tokens or via internal proxy endpoints

#### Workspace Root Agent Instructions + Tool Scripts

At the **root of every workspace**, we include a markdown “operating manual” for the opencode agent:
- `AGENTS.md`: what a “workflow” is, required files, conventions, and how to create/update/run workflows safely.

We also include a folder of **pre-written scripts** the agent can invoke as tools:

```
<workspace_root>/
├── AGENTS.md
└── tools/
    └── findSimilarWorkflow  # return up to N similar workflows for a description
```

**Tool scripts** are the stable integration boundary between the local agent and the self-hosted instance:
- `findSimilarWorkflow`: queries embeddings/metadata and returns up to N candidate workflows (with paths + summaries) to reuse/adapt.

**Key constraint (simple architecture):** tool scripts talk to the **Node backend API**, and the Node backend is responsible for forwarding the right information to/from the opencode agent.

#### opencode Plugins (Async/Long-Running Operations)

For operations where the result may take hours (e.g., waiting for a human engineer to respond), we use **opencode plugins** instead of tool scripts. This allows the agent to pause and resume when the result becomes available.

- `askAnEngineer`: opens a question thread in the FlowPal UI, routes it to engineers/admins, and the result is passed back to the agent only when a human responds. This can take minutes to hours, so it's implemented as a plugin rather than a blocking tool call.

### 2.3 Workflow System

**Features:**
- Natural language to code generation
- Similarity search for reuse (optional; uses pgvector embeddings)
- Execution history and audit logs

#### Workflow Lifecycle

In v1, FlowPal does **not** implement workflow versioning or an approval gate.

- A workflow is whatever is currently in `workflows/<slug>/`.
- Changes are applied directly to the workflow folder (agent edits files in place).
- Execution is allowed immediately (subject to RBAC + any operator-configured sandbox/network policy).

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
        ├── .env                   ← Required: runtime secrets (human-managed; not committed)
        ├── .venv/                 ← Required: per-workflow virtualenv (local)
        ├── requirements.lock.txt  ← Required: pinned deps for reproducibility
        ├── .env.example           ← Recommended: documented template (committed)
        ├── data/                  ← Optional: non-secret config/state files
        └── runs/                  ← Optional: run outputs/logs (local artifacts)
```

#### Workflow Contract (How the System Knows What a Workflow Does)

FlowPal does not attempt to parse arbitrary `run.py`. Instead, each workflow folder contains a small manifest in `workflow.json` that the UI and execution layer treat as the workflow's contract:
- **`intent_summary`**: human-readable "what it does" summary
- **`inputs`**: required/optional inputs with types/defaults
- **`triggers`**: trigger configuration (manual is always true)
- **`runtime`**: execution requirements (python version, timeout)

#### Workflow Conventions (Filesystem-First)

To keep self-hosting predictable:
- Workflows must be runnable from their folder with `python run.py {optional args}`.
- Workflow outputs are written to the console (stdout/stderr).
- Optionally write artifacts to `runs/` if file output is needed.
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
- The runner process fetches secrets at runtime and injects them into the execution environment (env vars) for that single run only.
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
- modify existing workflows (edits files in place)
- request missing information from a human via the `askAnEngineer` opencode plugin
- reuse existing work via `findSimilarWorkflow` tool (optional but recommended when pgvector is enabled)

In this architecture, the Node backend maintains a bi-directional communication channel with the opencode agent (e.g., WebSocket). It:
- forwards UI chat messages (user → agent)
- forwards agent events (agent → UI): status, diffs (optional), questions, run progress
- persists artifacts to Postgres (workflow metadata, run metadata, audit logs)

For OSS, the `askAnEngineer` plugin is implemented as:
- creating a UI task / notification for an Admin/Engineer
- optionally sending email/Slack if configured
- returning the answer to the agent only when a human responds (can take hours)

### 2.7 Workflow Data Layer

Each workflow can store small bits of non-secret state/data in the `data/` folder within the workflow directory. This is plain filesystem storage.

Operators should treat workflow data as **application state** and back it up with the rest of the workspace volume.

### 2.8 Execution Environment

Workflows execute on the **user machine** (where opencode is running) in the workspace. The backend coordinates and records metadata, but does not require a separate worker tier.

Execution responsibilities:
- uses the workflow's `.venv/` virtualenv
- installs dependencies from `requirements.txt`
- runs `python run.py` with command-line arguments
- captures console output (stdout/stderr)

**Sandbox choices:**
- **Simplest**: Docker container + Linux user isolation (fastest to ship, weakest boundary)
- **Recommended**: gVisor or Firecracker (stronger isolation for untrusted code)

### 2.9 Workflow Triggers & Inputs

Triggers:
- **manual** (from UI or by the agent) — always enabled

Inputs are passed as command-line arguments to `run.py`. Use `argparse` to parse them:

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--customer_id", required=True, help="The Stripe customer ID")
parser.add_argument("--days_back", type=int, default=7, help="Days to look back")
args = parser.parse_args()
```

### 2.10 Error Handling

Per workflow runtime config:
- timeout

Design workflows to be idempotent when possible. Document idempotency expectations in `README.md`.

---

## 3. AI Agent Tools & Plugins (OSS Distribution)

**Built-in opencode capabilities:**
- `fs`: read/write within workspace
- `shell`: run commands (venv, install deps, run workflow)
- `http`: make outbound requests (optional; can be disabled globally)

**Workspace tool scripts** (in `./tools/`):
- `findSimilarWorkflow`: query similar workflows via backend API

**opencode plugins** (for async/long-running operations):
- `askAnEngineer`: create a question task for Admin/Engineer, resume when answered

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
- `workflow_created`: new workflow folder created
- `workflow_updated`: existing workflow modified
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

---

## 5. Communication System (Self-Hosted)

### Human Question Flow (OSS)

When the agent needs information it doesn't have:
1. Agent identifies missing info (credentials, schema, API details)
2. Agent creates a question/task in the app addressed to Admin/Engineer
3. Optional notifications are sent (email/Slack/webhooks if configured)
4. Human answers (with optional “save to knowledge base”)
5. Agent resumes with the answer

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
| Runtime | Node.js |
| API Framework | Express or Fastify (TypeScript) |
| Database | PostgreSQL (pgvector optional) |
| Real-time | WebSocket (ws/Socket.IO) or SSE |
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
- audit logs for edits, executions, and credential access

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
1. user sends a chat request in the UI
2. Node backend forwards the message to the opencode agent (running on the user machine)
3. agent inspects existing workflows for reuse (and may call `findSimilarWorkflow` tool)
4. if missing info: agent uses the `askAnEngineer` plugin — the agent pauses until a human responds (can take hours)
5. agent writes/updates a workflow folder
6. backend indexes metadata in Postgres (workflow list) and the UI reflects the updated workflow immediately

### Executing a Workflow
1. user triggers run manually (from UI or agent)
2. backend starts a run session (RBAC enforced) and forwards run request to the agent/runner on the user machine
3. run is executed on the workspace host (local runner), optionally using a sandbox policy (Docker/gVisor/Firecracker depending on operator preference)
4. console output (stdout/stderr) is captured; optional artifacts written to `runs/`
5. run metadata stored in Postgres; UI streams status/logs

---

## 9. UI/UX (OSS)

Minimum UI surfaces:
- chat screen (requests + agent updates)
- workflows list + detail page
- workspace viewer (VSCode in browser) to view the workspace directory via the web app
- code viewer/editor for Admin/Engineer
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
- Postgres
- workflow creation/editing + run history
- run history

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

### Why Node Backend ↔ Local Agent (Instead of Running the Agent Server-Side)?
- keeps code execution and workspace access on the user machine
- makes the “tools → backend → agent” boundary explicit and debuggable
- keeps the hosted/self-hosted stack minimal: Next.js + Node + Postgres

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
- **reliability**: backend restarts do not corrupt history; agent disconnect/reconnect is handled cleanly; runs are idempotent where needed

---

## 14. Critical Files to Implement First (Repo Layout Suggestion)

Backend:
- `apps/api/` (Node API: auth, chat, workflows, runs)
- `packages/db/` (schema + migrations)
- `packages/agent/` (agent orchestration + tools)

Frontend:
- `apps/web/` (Next.js UI)

Infra (OSS):
- `docker-compose.yml`
- `deploy/helm/` (optional)
- `docs/self-hosting.md` (operator guide)

