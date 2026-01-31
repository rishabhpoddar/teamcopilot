# FlowPal Architecture Document

## Executive Summary

FlowPal is a multi-tenant SaaS platform that enables organizations to define and execute programmatic workflows using AI. Users describe what they want in natural language, and a **single agent** (with full access to a tenant-scoped filesystem + shell) can create, update, and run workflows directly inside that workspace.

---

## 1. High-Level Architecture

```
                                    +------------------+
                                    |   FlowPal Web    |
                                    |   Application    |
                                    +--------+---------+
                                             |
                                             v
+------------------+              +----------+---------+              +------------------+
|   Notification   |<----------->|    API Gateway     |<------------>|  Authentication  |
|   Service        |              |  (Kong/Traefik)   |              |                  |
+------------------+              +----------+---------+              +------------------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
                    v                        v                        v
          +---------+---------+    +---------+---------+    +---------+---------+
          |   Workflow        |    |   AI Agent        |    |   Execution       |
          |   Service         |    |   (Single)        |    |   Service         |
          +---------+---------+    +---------+---------+    +---------+---------+
                    |                        |                        |
                    |                                                 |
                    v                        v                        v
          +---------+---------+    +---------+---------+    +---------+---------+
          |   PostgreSQL      |    |   Tenant          |    |   Sandbox         |
          |   (pgvector)      |    |   Workspace FS    |    |   Runtime         |
          +-------------------+    +-------------------+    +-------------------+
```

---

## 2. Core Components

### 2.1 Multi-Tenant Architecture

**Isolation Strategy: Hybrid Model**

| Layer | Approach | Implementation |
|-------|----------|----------------|
| **Data** | Shared DB with tenant_id filtering | PostgreSQL Row-Level Security (RLS) |
| **Compute** | Namespace isolation | Kubernetes namespaces per tenant |
| **Credentials** | Logical isolation with encryption | Per-tenant encryption keys |

**User Roles:**
- **Admin**: Full organization management, billing, user management
- **Engineer**: Can respond to AI queries, provide credentials, configure integrations, **review/approve workflows**, and **edit workflow code**
- **User**: Can create workflows, request runs, view results (subject to approval and permissions)

### 2.2 Single-Agent Architecture (Filesystem-First)

FlowPal uses **one agent** that has:
- a **tenant-scoped workspace filesystem** (containing all workflows in folders)
- the ability to run **shell commands** inside that workspace

This is intentionally simple: the agent can discover existing workflows by listing folders, decide whether to create a new workflow vs run an existing one, and implement changes by editing files.

**Important implication:** if the agent has full filesystem + shell access, then any secrets present in that workspace are accessible to the agent. This plan therefore treats credential security as a deployment choice:
- **MVP / simplest**: credentials live in per-workflow `.env` files (human-managed). Fast to build, but secrets are not hidden from the agent.
- **Production / safer**: credentials are never written into the workspace; instead workflows call internal proxy endpoints or use short-lived scoped tokens injected at run time. (See Credential Handling section.)

### 2.3 Workflow System

**Features:**
- Natural language to code generation
- Version control for workflows
- **Approval gate for newly created workflows**
- Similarity search for reuse (pgvector embeddings)
- Execution history and audit logs

**Similarity Detection:** When a user creates a workflow similar to an existing one (>90% similarity), the system can adapt the existing workflow instead of generating from scratch.

#### Workflow Lifecycle

**Workflow version states (simplified):**
- **pending**: Awaiting engineer review (not executable)
- **approved**: Executable (manual, scheduled, webhook triggers)
- **rejected**: Not executable; retains review notes

**Versioning policy:**
- Editing workflow code/contract files (`run.py`, `workflow.json`, `README.md`, `requirements.txt`, `.env.example`) creates a **new immutable version** that returns to **pending**.
- Editing `data/` does **not** create a new version (data is mutable by design); editing `.env` is a local operational change and is never versioned/approved via FlowPal.
- Approval metadata stored with the version: `approved_by`, `approved_at`, `approval_notes`.

#### Workflow Package Structure

Each workflow is a folder in the tenant workspace. Workflows are **filesystem-first**: the folder contents are the source of truth.

```
Tenant Workspace
└── workflows/
    └── failed-stripe-payments/
        ├── workflow.json          ← Required: workflow contract + runtime metadata
        ├── README.md              ← Required: docs + usage (with frontmatter)
        ├── run.py                 ← Required: entrypoint script
        ├── requirements.txt       ← Required: Python deps (pinned if possible)
        ├── .env                   ← Required: runtime config (human-managed; not committed)
        ├── .env.example           ← Recommended: documented template (committed)
        ├── .gitignore             ← Recommended: ignore `.env`, `.venv/`, `runs/`, etc.
        ├── .venv/                 ← Recommended: per-workflow virtualenv (created locally)
        ├── requirements.lock.txt  ← Recommended: fully pinned deps for reproducibility
        ├── data/                  ← Optional: non-secret config/state files
        ├── runs/                  ← Optional: run outputs/logs (local artifacts)
        ├── versions/              ← Optional: approved snapshots (immutable)
        └── tests/                 ← Optional: unit/integration tests
```

#### Workflow Contract (How the System Knows What a Workflow Does)

In v1, FlowPal does **not** try to “understand” arbitrary Python by parsing `run.py`. Instead, every workflow folder contains a small **manifest** in `workflow.json` that the UI and execution layer treat as the workflow’s contract:

- **`intent_summary`**: a human-readable “what it does” summary (generated by AI, editable by engineers during review)
- **`input_schema`**: JSON Schema describing runtime arguments (used to render the Run form and validate inputs)
- **`output_schema` (optional)**: JSON Schema describing the shape of the workflow output JSON (used to label/render results)
- **`side_effects`**: short list of expected external effects (helps review and safe re-runs)
- **`env_vars` / `egress_allowlist`**: concrete runtime and security constraints (reviewable and enforceable)

**Contract enforcement (simple v1 rule):**
- Workflows accept runtime inputs via `FLOWPAL_INPUT_JSON` (a JSON object string) and/or standard input (see Workflow Conventions).
- If `input_schema` is present, the API validates inputs before launching a run; missing/invalid inputs fail fast with a clear error.

**Why a workflow folder (not a single file)?**
- **Practicality**: workflows need docs, env config templates, and dependency manifests
- **Reproducibility**: `requirements.txt` + `.venv` keeps dependencies scoped
- **Operability**: `runs/` artifacts make debugging and auditing easy

**Engineer review/edit surface:**
- Engineers can view and edit `run.py`, `workflow.json`, and `README.md` before publishing
- The review UI highlights:
  - **Diff** vs prior version
  - **`.env.example`** changes (and warnings if `.env` was modified)
  - **Network egress** targets
  - Optional: **Test Run** in a restricted sandbox before approval

#### Workflow Conventions (Filesystem-First)

These conventions are what make “one agent with filesystem + bash” reliable.

**Folder location:**
- All workflows live under `workflows/<workflow_slug>/` within the tenant workspace.

**Required files:**
- `workflow.json`: machine-readable contract (inputs/outputs/egress/timeout/etc).
- `README.md`: human-readable docs, with frontmatter (see below).
- `run.py`: entrypoint that performs the workflow.
- `requirements.txt`: dependencies for `run.py`.
- `.env`: runtime config for the workflow (human-managed; not committed).

**Strongly recommended files:**
- `.env.example`: template for `.env` (committed; never contains real secrets).
- `.venv/`: per-workflow virtual environment (created locally; not committed).
- `.gitignore`: ensures `.env`, `.venv/`, `runs/`, and other local artifacts are never committed.
- `requirements.lock.txt` (or `constraints.txt`): fully pinned dependency lock for reproducible runs (optional for MVP, recommended for critical workflows).

**Optional files/folders (supported):**
- `data/`: non-secret config/state files (JSON/YAML/CSV) that the workflow reads/writes.
- `runs/`: local run artifacts: `runs/<run_id>/{stdout.log,stderr.log,output.json,meta.json}`.
- `versions/`: immutable snapshots of approved versions (optional implementation detail; useful for audit/debug).
- `tests/`: tests that can be run with `pytest`.
- `scripts/`: helper scripts like `scripts/setup.sh` or `scripts/test.sh`.
- `.python-version`: pin interpreter version when using pyenv/asdf (optional; `runtime` in `workflow.json` remains the source of truth).

**README frontmatter format:**

`README.md` must start with YAML frontmatter:
```yaml
---
name: "Workflow Name"
summary: "One-line description shown in the UI."
---
```

Then the rest of the README contains:
- detailed description
- setup steps (venv creation, install deps, `.env` creation)
- how to run (example inputs)
- expected output shape
- troubleshooting and safety notes

**Standard runtime input interface:**
- The runner sets `FLOWPAL_INPUT_JSON` to a JSON object string (validated by `input_schema` when present).
- The runner executes `run.py` from the workflow directory.

Example command shape (implementation detail):
`FLOWPAL_INPUT_JSON='{"days":7}' ./.venv/bin/python run.py`

**Output convention:**
- `run.py` must produce a JSON result either by printing JSON to stdout or writing `runs/<run_id>/output.json` (the runner will capture/normalize results).

**Workflow discovery:**
- The agent discovers workflows by listing `workflows/` and reading each `workflow.json` + `README.md` frontmatter.

### 2.4 Credential & Knowledge Management

**Credential Handling (Filesystem-First v1):**

Because the agent has filesystem + shell access, FlowPal defines credentials as a **human-managed runtime concern**:
- Each workflow folder contains a `.env` file with required environment variables.
- `.env` is never committed; `.env.example` documents the expected keys.
- The simplest approach is to place secrets directly in `.env`. This is operationally easy but means the agent can read those secrets.

**Safer production approach (recommended):**
- Do not place raw secrets in the workspace.
- Workflows authenticate via short-lived, scoped tokens minted at run time, or call internal proxy endpoints that hold secrets.
- The runner injects only those scoped tokens into the environment (and audits usage).

**Knowledge Base:**
- Stores learned information from engineers
- Vector embeddings for semantic search
- Categories: database_schema, api_endpoint, business_rule, etc.
- Auto-populated when engineers answer AI questions
- Knowledge entries can optionally link to an integration via `integration_id`

### 2.5 Tenant Context Model

All tenant-specific data that informs workflow creation:

```
Tenant Context Store (PostgreSQL + Workspace FS)
│
├── Workflows (Workspace FS)
│   └── workflows/<workflow_slug>/{workflow.json,README.md,run.py,...}
│
├── Integrations (PostgreSQL)
│   │
│   │  An integration groups credentials + provides context for AI matching
│   │
│   ├── integration_id, name, description
│   ├── description_embedding (pgvector) → for matching to workflow requests
│   └── credentials[] → list of credential refs
│
├── Knowledge Base (PostgreSQL + pgvector)
│   ├── knowledge_id, title, content, category
│   ├── content_embedding → for semantic search
│   ├── integration_id (optional) → links to an integration
│   └── Auto-indexed engineer answers
```

**Context Retrieval for New Workflows:**
When a user requests a new workflow, the agent:
1. Lists existing workflow folders and reads `workflow.json` + `README.md` summaries
2. (Optional) Searches similar workflows by embedding similarity
3. Matches the request against integration descriptions / knowledge base
4. Creates a new workflow folder or updates an existing one (by editing files)

### 2.6 Agent Interaction Model

There is no separate “coding agent” and no internal agent-to-agent protocol.

The single agent:
- reads tenant context from the workspace filesystem and Postgres-backed knowledge/integration metadata
- creates/updates workflow folders by editing files
- runs workflows using shell commands in the sandbox runtime

When the agent is missing critical information (e.g., “DB schema”, “which Slack channel to notify”), it uses the existing “ask engineer” flow (see Communication System section). Answers can be persisted into the knowledge base to reduce future questions and runs.

### 2.7 Workflow Data Layer

Workflows often need to operate on data that changes more frequently than the code itself. The **Workflow Data Layer** allows data to be stored and modified separately from the code.

**Why Separate Data from Code?**

| Scenario | Without Data Layer | With Data Layer |
|----------|-------------------|-----------------|
| Add test cases to a test workflow | Modify `run.py`, re-approve | Add rows to test data, no code change |
| Update filtering rules | Modify code logic, re-approve | Update rules in data store |
| Change notification recipients | Hardcode in `run.py` | Store in workflow data |
| Adjust thresholds/parameters | Code change required | Update configuration data |

**Key Benefits:**
- **No re-approval needed** for data-only changes
- **AI can modify behavior** by updating data instead of regenerating code
- **Users can edit data** directly via UI without touching code

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW FOLDER (Workspace FS)                   │
│  Code + docs + dependency manifest                                   │
│  ├── run.py                                                         │
│  ├── workflow.json                                                   │
│  ├── README.md                                                       │
│  └── requirements.txt                                                │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ read/write files in `data/`
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW DATA FOLDER                              │
│  Mutable data (can be modified without regenerating code)            │
│  Location: workflows/<workflow_slug>/data/                            │
│                                                                        │
│  ├── config.json         ← Key-value configuration                     │
│  ├── test_cases.json     ← Array of test case objects                 │
│  ├── rules.json          ← Business rules / filters                    │
│  └── {custom_key}.json   ← Any arbitrary data                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Access Pattern (no SDK required):**

```python
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

# Read data (returns None if key doesn't exist)
test_cases_path = DATA_DIR / "test_cases.json"
config_path = DATA_DIR / "config.json"

test_cases = json.loads(test_cases_path.read_text()) if test_cases_path.exists() else []
config = json.loads(config_path.read_text()) if config_path.exists() else {"threshold": 100}

# Write data (from within workflow execution)
(DATA_DIR / "last_run_stats.json").write_text(json.dumps({"processed": 150, "failed": 3}))

# Append to array data (best-effort)
test_cases.append({"input": "new test", "expected": "result"})
test_cases_path.write_text(json.dumps(test_cases))
```

**Data Schema Declaration (optional in workflow.json):**

```json
{
  "runtime": "python3.11",
  "data_schema": {
    "test_cases": {
      "type": "array",
      "items": { "type": "object" },
      "ui_editor": "table"
    },
    "config": {
      "type": "object",
      "ui_editor": "form"
    }
  }
}
```

**Data Modification Methods:**

| Method | Who | Use Case |
|--------|-----|----------|
| **UI Editor** | Users/Engineers | Manual edits via FlowPal web app |
| **AI Agent** | Agent | AI modifies data in response to user requests |
| **Workflow Self-Modification** | run.py | Workflow updates its own data during execution |
| **API** | External systems | Webhooks or API calls update workflow data |

### 2.8 Execution Environment

**Sandbox Options:**
- **Firecracker microVMs** - Strongest isolation (recommended for production)
- **gVisor containers** - Lighter weight for lower-risk workloads

**Security Features:**
- Isolated filesystem per execution
- Network egress whitelist only
- Resource limits (CPU, memory, time)
- Pre-installed runtimes (Python, Node.js)
- Tenant workspace mounted read/write (or copied into an ephemeral run dir)

**Credential Handling:**
- v1 simplest: the runner loads environment variables from the workflow’s `.env` (human-managed)
- production: the runner injects only short-lived scoped tokens or uses an internal proxy (no raw secrets in workspace)

**Execution Flow:**

```
1. Trigger workflow (manual, scheduled, or webhook)
                    |
                    v
2. Provision fresh sandbox (Firecracker/gVisor)
   - Mount tenant workspace (or copy workflow folder to an ephemeral run dir)
   - Load `.env` (and/or inject scoped tokens)
                    |
                    v
3. Run run.py
   - Idempotent setup (install deps if not present)
   - Actual workflow logic executes
   - All external access through egress whitelist
   - Logs streamed via WebSocket
                    |
                    v
4. Capture results, destroy sandbox
   - Output JSON stored in execution history
   - Sandbox destroyed (no state leakage)
```

### 2.9 Workflow Triggers & Inputs

**Trigger Types:**

| Type | Description |
|------|-------------|
| **Manual** | User clicks "Run" in the UI or calls API |
| **Scheduled** | Cron-based scheduling (e.g., "0 9 * * MON") |
| **Webhook** | External HTTP POST triggers execution |

**Scheduling:**
- Cron syntax with timezone support (e.g., `0 9 * * MON America/New_York`)
- Configurable concurrency policy: `allow_overlap` or `skip_if_running`
- Schedule management via UI and API

**Webhook Triggers:**
- Each workflow can have a unique webhook URL: `POST /api/webhooks/{workflow_id}/{secret_token}`
- Payload is passed to workflow as part of `FLOWPAL_INPUT_JSON` (e.g. `{ "webhook_payload": {...} }`)
- Authentication via secret token in URL or HMAC signature header

**Runtime Input Parameters:**

Workflows can accept input parameters at execution time:

```python
import json
import os

inputs = json.loads(os.environ.get("FLOWPAL_INPUT_JSON", "{}"))

# Get input passed at trigger time
customer_id = inputs["customer_id"]
date_range = inputs.get("date_range", {"days": 7})

# Use in workflow logic
orders = fetch_orders(customer_id, date_range)
```

**Input Sources:**
- **Manual runs**: User provides inputs via form in UI
- **Scheduled runs**: Inputs defined in schedule configuration
- **Webhook runs**: Inputs extracted from webhook payload
- **API calls**: Inputs passed in request body

**How inputs are defined (v1):**
- The agent generates an `input_schema` in `workflow.json` whenever practical.
- The UI/runner use `input_schema` to:
  - Render a simple “Run workflow” form
  - Validate inputs on `POST /api/workflows/{id}/run`
  - Provide better errors (“customer_id is required”) instead of runtime stack traces
- If `input_schema` is missing, the run endpoint accepts a free-form JSON object and passes it through unchanged.

**Input Schema (optional in workflow.json):**

```json
{
  "input_schema": {
    "type": "object",
    "properties": {
      "customer_id": { "type": "string" },
      "date_range": {
        "type": "object",
        "properties": { "days": { "type": "number" } },
        "default": { "days": 7 }
      }
    },
    "required": ["customer_id"]
  }
}
```

### 2.10 Error Handling & Retry

**Execution Failure Handling:**

| Failure Type | Default Behavior | Configurable |
|--------------|------------------|--------------|
| **Code Exception** | Mark run as failed, log stack trace | - |
| **Timeout** | Kill sandbox, mark as timeout | `timeout_seconds` in workflow.json |
| **Sandbox Provisioning** | Retry up to 3 times, then fail | - |
| **Credential Resolution** | Fail immediately, notify engineers | - |

**Retry Policy (configurable in workflow.json):**

```json
{
  "retry": {
    "enabled": true,
    "max_attempts": 3,
    "backoff": "exponential",
    "initial_delay_seconds": 60
  }
}
```

**Failure Notifications:**
- Failed runs trigger notifications to workflow owner
- Configurable channels: in-app, email, Slack
- Includes: error message, stack trace, execution logs

**Dead Letter Queue:**
- After max retries exhausted, execution is moved to DLQ
- Engineers can inspect, fix, and manually retry
- DLQ items expire after 30 days

**Circuit Breaker:**
- If a workflow fails N times in M minutes, pause automatic triggers
- Prevents runaway failures for scheduled/webhook workflows
- Engineers notified to investigate

---

## 3. AI Agent Tools

The single agent is intentionally given a minimal capability surface: It will have the same set of tools as OpenCode has.
---

## 4. User Interface & API

### How Users Interact with the Agent

**Chat Interface:**
- Users interact with FlowPal through a chat-like interface in the web app
- Natural language requests are sent to the agent
- The agent responds with status updates, questions, or completed workflows

**API Endpoint:**
```
POST /api/chat
{
  "message": "Create a workflow that checks Stripe for failed payments daily",
  "workflow_id": null  // null for new, or ID for modifying existing
}
```

**Response Types:**
- `workflow_created`: New workflow generated, pending approval
- `workflow_updated`: Existing workflow modified
- `data_updated`: Workflow data changed (no code change)
- `question`: Agent needs clarification
- `engineer_needed`: Question routed to engineer, will resume when answered

**Workflow Operations API:**

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

## 5. Communication System

### Engineer Question Flow

When the AI needs information it doesn't have:

1. AI identifies missing info (credentials, schema, API details)
2. Creates a question in the system
3. Notifies engineers via Slack, email, and in-app
4. Engineer answers with option to save to knowledge base
5. AI resumes workflow creation with the answer
6. Knowledge persisted for future similar requests

### Workflow Approval Flow

1. User requests a new workflow in natural language
2. Agent creates/updates the workflow folder (`run.py`, `workflow.json`, `README.md`, `requirements.txt`, `.env.example`)
3. Workflow version is saved as **pending**
4. Engineers are notified with a link to review
5. Engineer reviews and can **edit** the workflow files
6. Engineer approves → version becomes **approved**, triggers enabled
7. All actions are audited

### Real-Time Updates

- WebSocket connections for live execution status
- Progress indicators during workflow creation
- Log streaming during execution

---

## 6. Tech Stack

### Backend
| Component | Technology |
|-----------|------------|
| API Framework | Hono (TypeScript) |
| Runtime | Bun |
| Database | PostgreSQL + pgvector |
| Cache/Queue | Redis + BullMQ |
| Real-time | Socket.IO |
| Sandbox | Firecracker/gVisor |

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | Next.js 15 (App Router) |
| UI | shadcn/ui |
| State | TanStack Query |
| Code Editor | Monaco Editor |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Orchestration | Kubernetes |
| Secrets | v1: per-workflow `.env` in workspace (human-managed); production: Vault / AWS Secrets Manager |
| Storage | Per-tenant filesystem volume (source of truth for workflows); optional S3-compatible backups/artifacts |
| Monitoring | Prometheus + Grafana |

---

## 7. Security Model

All security concerns are consolidated here for clarity.

### Network Security (Layer 1)
- WAF for common attack patterns
- Rate limiting per tenant and per endpoint
- DDoS protection at edge

### Authentication & Authorization (Layer 2)
- JWT tokens with short expiry
- RBAC: Admin, Engineer, User roles
- Org-scoped permissions (users can only access their org's data)

### Data Security (Layer 3)
- PostgreSQL Row-Level Security (RLS) enforces tenant isolation
- All queries automatically filtered by tenant_id
- Audit logs for all data modifications
- Unified audit service for: workflow versions, workflow data, credential access, executions

### Credential Security (Layer 4)
- Envelope encryption with KMS-managed master keys
- Per-tenant data encryption keys (DEK)
- Credentials never exposed to AI agents (only references)
- Credentials never stored in workflow code or database
- Audit logging of all credential access

### Execution Security (Layer 5)
- Firecracker microVM isolation per execution
- Network egress whitelist (no arbitrary outbound connections)
- Resource limits: CPU, memory, execution time
- Sandbox destroyed after each execution (no state leakage)

### AI Safety (Layer 6)
- Prompt injection detection
- Generated code scanned for dangerous patterns
- Engineer approval required before any workflow can execute
- Natural language queries validated before processing

### Workflow Data Security
- Tenant-isolated by per-tenant workspace mounts and API authorization (no cross-tenant filesystem access)
- `data/` should not contain raw credentials (treat it as non-secret config/state)
- Size limits: 10MB per key, 100MB per workflow
- Rate limits on writes
- Schema validation when declared

---

## 8. Data Flow

### Creating a Workflow

```
1. User: "Create workflow to check Stripe for failed payments and notify finance"
                    |
                    v
2. Agent: Analyze request, gather context
   - List existing workflow folders (`workflows/`)
   - Search similar workflows (pgvector) (optional)
   - Search knowledge base for relevant docs
   - Search tenant's integrations (finds "Stripe" integration)
                    |
                    v
3. Missing information?
   - Yes → Ask engineer (async), wait for response
   - No → Continue
                    |
                    v
4. Agent creates/updates a workflow folder:

   run.py (example shape):
   ┌─────────────────────────────────────────────────────┐
   │ import json                                         │
   │ import os                                           │
   │ import stripe                                       │
   │                                                     │
   │ inputs = json.loads(os.environ.get("FLOWPAL_INPUT_JSON", "{}")) │
   │ customer_id = inputs["customer_id"]                 │
   │                                                     │
   │ # Credentials come from env (runner loads .env)      │
   │ stripe.api_key = os.environ["STRIPE_API_KEY"]        │
   │                                                     │
   │ # Workflow logic                                    │
   │ failed = stripe.PaymentIntent.list(customer=customer_id, status="failed") │
   │                                                     │
   │ # Output results                                    │
   │ print(json.dumps({                                  │
   │     "count": len(failed.data),                      │
   │     "payments": [p.to_dict() for p in failed.data]  │
   │ }))                                                 │
   └─────────────────────────────────────────────────────┘
                    |
                    v
5. Validate & index workflow
   - Security scan for dangerous patterns
   - Store/update metadata + embeddings in PostgreSQL
   - Workflow folder in workspace FS is the source of truth
                    |
                    v
6. Engineer approval (required)
   - Set version state: pending
   - Engineer can review + edit workflow files in UI
   - On approval: mark version approved, enable triggers
                    |
                    v
7. Ready for execution
```

### Executing a Workflow

```
1. Trigger (manual, scheduled, or webhook with optional inputs)
                    |
                    v
2. Provision sandbox (Firecracker/gVisor)
   - Mount tenant workspace (or copy workflow folder to ephemeral run dir)
   - Load `.env` (and/or inject scoped tokens)
   - Pass inputs via `FLOWPAL_INPUT_JSON`
                    |
                    v
3. Run run.py
   - Idempotent setup (install deps if needed)
   - Workflow logic executes
   - Logs streamed via WebSocket
   - stdout/stderr captured; JSON output normalized
                    |
                    v
4. Capture results, destroy sandbox
   - Output JSON stored in execution history
   - Sandbox destroyed
                    |
                    v
5. User views results
   - Built-in renderers: JSON tree, auto-table, log viewer
   - Downloadable artifacts if any
```

---

## 9. UI/UX

**Workflows**
- Workflow list: search/filter by status, tags, owner
- Workflow detail: overview, triggers, versions, recent runs, data editor
- Workflow data tab: view/edit workflow data with schema-aware editors

**Approvals (Engineers)**
- Approval queue: list pending workflow versions
- Review screen: run.py / workflow.json tabs, diff view, inline editing (Monaco), approve/reject with notes

**Executions / Runs**
- Runs list: filter by workflow, status, time range, trigger source
- Run detail: logs (live + final), inputs/outputs, retry controls

**Results Display:**
- **JSON Tree Viewer** - Collapsible JSON display of raw output
- **Auto-Table** - Automatic table rendering for array-of-objects data
- **Log Viewer** - Execution logs with timestamps

**Integrations (Engineers/Admins)**
- Integration list: search by name/description
- Create/edit: name + description, link credentials
- Knowledge docs are managed separately but can reference integrations

---

## 10. Implementation Phases

| Phase | Focus |
|-------|-------|
| 1 | Foundation: Multi-tenant DB, auth, basic API |
| 2 | Core Workflow: filesystem-backed workflow CRUD, basic sandbox runner |
| 3 | AI Agent Layer: single agent (filesystem + shell), similarity search (optional) |
| 4 | Credentials: `.env` workflow config, engineer Q&A, notifications; production option: Vault/proxy |
| 5 | Triggers: Scheduling, webhooks, input parameters |
| 6 | Hardening: Firecracker, security audit, monitoring |

---

## 11. Key Design Decisions

### Why a Single Agent with Full Workspace Control?
- **Fewer moving parts**: no agent-to-agent protocols, fewer “tool calls”, simpler debugging
- **Filesystem as state**: workflows are discoverable and editable by listing folders and reading files
- **Operational clarity**: everything needed to run a workflow (code/docs/deps/config) lives in one folder
- **Good enough for MVP**: production-grade secret isolation can be added later (proxy/scoped tokens)

### Why pgvector for Similarity?
- Single database for relational + vector data
- Proven PostgreSQL reliability
- Simpler ops than separate vector DB

### Why Firecracker for Sandboxing?
- AWS-proven technology (used by Lambda)
- Sub-second boot times
- Strong security isolation
- Better than containers for untrusted code

### Why Single run.py Instead of setup.py + run.py?
- Simpler mental model (one file to review)
- No snapshot management complexity
- Idempotent setup patterns work well in practice
- Faster to implement for MVP

---

## 12. Future Enhancements

These features are intentionally deferred to reduce initial complexity:

### Dynamic UI Layer
- AI-generated custom React components for result visualization
- Sandboxed iframe rendering with pre-bundled libraries
- Currently using built-in renderers (JSON tree, auto-table) instead

### Workflow Chaining / DAGs
- Workflow B triggers after Workflow A completes
- DAG-based workflow composition
- Currently: each workflow is independent

### Long-Running Workflows
- Checkpointing for workflows that run hours/days
- Heartbeat monitoring
- Resumability after failures

### Cost/Usage Tracking
- Per-tenant AI token usage
- Compute time billing
- Usage quotas and alerts

### Advanced Scheduling
- Calendar-based exclusions (holidays)
- Timezone-aware complex schedules
- Currently: basic cron with timezone

---

## 13. Verification Plan

To verify the architecture works end-to-end:

1. **Auth Flow**: Create org, invite user, assign roles
2. **Workflow Config**: Create `.env.example` + `.env` for a workflow and verify the runner loads env vars correctly (production option: verify Vault/proxy path)
3. **Integration Setup**: Create integration with credentials
4. **Knowledge Base**: Add knowledge entry linked to integration
5. **Workflow Creation**: Submit prompt, verify agent creates a workflow folder with `workflow.json`, `README.md`, `requirements.txt`, `run.py`
7. **Engineer Q&A**: Trigger missing info scenario, answer question, verify knowledge base update
8. **Approval Gate**: Create workflow as User, verify it is pending and cannot run
9. **Engineer Approve**: Approve workflow, verify it becomes runnable
10. **Manual Execution**: Run workflow, verify logs stream, results captured
11. **Scheduled Execution**: Create schedule, verify workflow runs on time
12. **Webhook Execution**: POST to webhook URL, verify workflow runs with payload
13. **Input Parameters**: Run with inputs, verify `FLOWPAL_INPUT_JSON` is passed and parsed correctly
14. **Workflow Contract**: Verify `intent_summary` + `input_schema` are present and used (run form + validation)
15. **Similarity**: Create similar workflow, verify reuse suggestion
16. **Workflow Data Folder**: Create workflow with `data/`, verify reads/writes work and UI editor updates files
17. **Data Modification via AI**: Ask AI to "add a test case", verify data updates without code change
18. **Error Handling**: Force a failure, verify retry and notifications
19. **Audit Trail**: Verify all actions logged in unified audit system

---

## 14. Critical Files to Implement First

1. `apps/api/src/db/schema.sql` - Database schema with RLS
2. `apps/api/src/agents/agent.ts` - Single agent entrypoint (filesystem + shell)
3. `apps/api/src/workspaces/tenant-workspace.ts` - Per-tenant workspace provisioning/mounting
4. `apps/api/src/execution/runner.ts` - Standard runner: loads `.env`, sets `FLOWPAL_INPUT_JSON`, captures output/logs
5. `apps/api/src/services/credentials/` - v1 `.env` management helpers; production option: Vault/proxy integration
6. `apps/api/src/services/audit/index.ts` - Unified audit logging service
7. `apps/api/src/execution/sandbox-manager.ts` - Sandbox provisioning
8. `apps/api/src/triggers/scheduler.ts` - Cron-based scheduling
9. `apps/api/src/triggers/webhook.ts` - Webhook handler
11. `apps/web/components/results-viewer/` - JSON tree, auto-table, log viewer
12. `apps/web/components/workflow-file-editor/` - Edit `run.py`, `workflow.json`, `README.md`, `data/` (Monaco + safe defaults)
