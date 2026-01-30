# FlowPal Architecture Document

## Executive Summary

FlowPal is a multi-tenant SaaS platform that enables organizations to define and execute programmatic workflows using AI agents. Users describe workflows in natural language, and a two-layer AI agent architecture implements, executes, and continuously improves these workflows.

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
|   Service        |              |  (Kong/Traefik)   |              |  (SuperTokens)   |
+------------------+              +----------+---------+              +------------------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
                    v                        v                        v
          +---------+---------+    +---------+---------+    +---------+---------+
          |   Workflow        |    |   AI Agent        |    |   Execution       |
          |   Service         |    |   Orchestrator    |    |   Service         |
          +---------+---------+    +---------+---------+    +---------+---------+
                    |                        |                        |
                    |              +---------+---------+              |
                    |              |   OpenCode        |              |
                    |              |   Server          |              |
                    |              +-------------------+              |
                    |                                                 |
                    v                        v                        v
          +---------+---------+    +---------+---------+    +---------+---------+
          |   PostgreSQL      |    |   Credential      |    |   Sandbox         |
          |   (pgvector)      |    |   Vault           |    |   Runtime         |
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
- **Engineer**: Can respond to AI queries, provide credentials, configure integrations, **review/approve workflows**, and **edit workflow code artifacts** (setup/run)
- **User**: Can create workflows, request runs, view results (subject to approval and permissions)

### 2.2 Two-Layer AI Agent Architecture

```
+------------------------------------------------------------------+
|                     ORCHESTRATOR AGENT (Custom)                    |
|  Manages workflow lifecycle, coordinates everything                |
|  DOES NOT directly access user databases or APIs                   |
|                                                                    |
|  - Context Manager        - Invokes Coding Agent                   |
|  - Similarity Search      - Credential Reference Lookup            |
|  - Engineer Communication - Execution Planner                      |
+------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     CODING AGENT (OpenCode)                        |
|  Generates workflow code that runs in sandbox                      |
|                                                                    |
|  - Code Generation        - File Operations                        |
|  - Database Query Code    - HTTP Request Code                      |
|  - Uses FlowPal SDK       - LSP Integration                        |
+------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     SANDBOX EXECUTION                               |
|  Generated code runs here with actual system access                |
|                                                                    |
|  - Connects to user databases via FlowPal SDK                      |
|  - Makes HTTP requests to user APIs                                |
|  - Credentials resolved at runtime (never in code)                 |
+------------------------------------------------------------------+
```

**Key Separation:**
- **Orchestrator**: Plans and coordinates, but never touches user data directly
- **Coding Agent**: Writes code that *will* access user systems when executed
- **Sandbox**: Where the generated code actually runs and interacts with user systems

**Why OpenCode?**
- Open source with a large community and strong ecosystem
- Model-agnostic (Claude, OpenAI, Google, or local models)
- Client/server architecture enables integration
- Built-in LSP support for code intelligence

### 2.3 Workflow System

**Features:**
- Natural language to code generation
- Version control for workflows
- **Approval gate for newly created workflows (and optionally for edits)**
- Similarity search for reuse (pgvector embeddings)
- Execution history and audit logs

**Similarity Detection:** When a user creates a workflow similar to an existing one (>90% similarity), the system can adapt the existing workflow instead of generating from scratch.

#### Workflow Lifecycle (Draft → Approval → Published)

To reduce risk from auto-generated code, a workflow version is **not executable** until an engineer approves it.

**Workflow version states:**
- **draft**: Created but not yet routed for approval (optional; can skip directly to pending_approval)
- **pending_approval**: Awaiting engineer review
- **approved (published)**: Executable (manual, scheduled, webhook triggers)
- **rejected**: Not executable; retains review notes
- **archived**: Hidden from default lists; preserved for audit

**Versioning policy (recommended):**
- Editing `setup.py` / `run.py` always creates a **new immutable version** (e.g. `v2`) that returns to **pending_approval**.
- Approval metadata stored with the version: `approved_by`, `approved_at`, `approval_notes` (plus full audit trail of edits).

#### Two-Phase Workflow Structure

Each workflow consists of **two code artifacts**, both generated by the Coding Agent:

```
Workflow Package (stored in S3)
├── setup.py                    ← Arbitrary setup logic (generated by Coding Agent)
│   - Clone git repos
│   - Install dependencies
│   - Download files from S3/URLs
│   - Create directories, config files
│   - Any custom environment preparation
│
├── run.py                      ← Workflow execution logic (generated by Coding Agent)
│   - The actual workflow business logic
│   - Uses FlowPal SDK for credentials, APIs, databases
│
└── workflow.json               ← Minimal metadata
    {
      "runtime": "python3.11",
      "credential_refs": ["cred:stripe", "cred:github-pat"],
      "timeout_seconds": 300,
      "persist_workspace": true
    }
```

**Why Two Phases?**
- **Flexibility**: Setup can handle any scenario (git clone, npm install, download datasets, etc.)
- **Consistency**: Everything is code generated by the same agent
- **Performance**: Workspace snapshots allow skipping setup on subsequent runs
- **Separation**: Setup runs once; execution runs many times

**Engineer review/edit surface (required for new workflows):**
- Engineers can view and edit **both** `setup.py` and `run.py` (and optionally `workflow.json`) before publishing.
- The review UI should highlight:
  - **Diff** vs prior version (or initial generated draft for `v1`)
  - **Credential refs** used (names/IDs only, no secret values)
  - **Network egress** targets (best-effort extraction) and/or declared allowlist in `workflow.json`
  - **Workspace persistence** implications (`persist_workspace`)
  - Optional: **Test Run** in a restricted sandbox before approval

### 2.4 Credential & Knowledge Management

**Credential Vault:**
- Envelope encryption (KMS-managed keys)
- Per-tenant data encryption keys (DEK)
- Audit logging of all access
- Never pass raw credentials to AI - only references

**Knowledge Base:**
- Stores learned information from engineers
- Vector embeddings for semantic search
- Categories: database_schema, api_endpoint, business_rule, etc.
- Auto-populated when engineers answer AI questions

### 2.5 Tenant Context Model

All tenant-specific data that informs workflow creation:

```
Tenant Context Store (PostgreSQL + S3)
│
├── Workflows (PostgreSQL + S3)
│   ├── workflow_id, name, description
│   ├── description_embedding (pgvector) → for similarity search
│   ├── current_published_version_id (nullable)
│   └── archived_at (nullable)
│
├── Workflow Versions (PostgreSQL + S3)
│   ├── workflow_version_id, workflow_id, version_number
│   ├── state: draft | pending_approval | approved | rejected | archived
│   ├── code_package_path (S3 reference to {setup.py, run.py, workflow.json})
│   ├── approved_by, approved_at, approval_notes (nullable)
│   ├── created_by, created_at
│   └── audit trail (who edited which files, when)
│
├── Integrations (PostgreSQL) - Generic, not typed
│   │
│   │  An integration is simply:
│   │  - A name and description
│   │  - One or more credential references
│   │  - Optional knowledge/documentation
│   │
│   ├── integration_id, name, description
│   ├── description_embedding (pgvector) → for matching to workflow requests
│   ├── credentials[] → list of credential refs (API keys, tokens, connection strings, etc.)
│   └── knowledge_ids[] → linked knowledge base entries (docs, schemas, examples)
│
│   Examples:
│   ┌────────────────────────────────────────────────────────────────┐
│   │ name: "Stripe"                                                 │
│   │ description: "Payment processing API"                          │
│   │ credentials: ["cred:stripe-api-key", "cred:stripe-webhook-secret"]│
│   │ knowledge: [doc about Stripe API, webhook event schemas]       │
│   └────────────────────────────────────────────────────────────────┘
│   ┌────────────────────────────────────────────────────────────────┐
│   │ name: "Production Database"                                    │
│   │ description: "Main PostgreSQL database for user data"          │
│   │ credentials: ["cred:prod-db-connection-string"]                │
│   │ knowledge: [schema docs, table descriptions, query examples]   │
│   └────────────────────────────────────────────────────────────────┘
│   ┌────────────────────────────────────────────────────────────────┐
│   │ name: "Company GitHub"                                         │
│   │ description: "GitHub org with data-pipelines and deploy repos" │
│   │ credentials: ["cred:github-pat"]                               │
│   │ knowledge: [repo list, branch conventions, CI/CD docs]         │
│   └────────────────────────────────────────────────────────────────┘
│   ┌────────────────────────────────────────────────────────────────┐
│   │ name: "Internal ML Service"                                    │
│   │ description: "Custom ML inference API running on internal k8s" │
│   │ credentials: ["cred:ml-api-key", "cred:ml-service-url"]        │
│   │ knowledge: [API docs, request/response examples]               │
│   └────────────────────────────────────────────────────────────────┘
│
├── Knowledge Base (PostgreSQL + pgvector)
│   ├── knowledge_id, title, content, category
│   ├── content_embedding → for semantic search
│   ├── integration_id (optional) → links to an integration
│   └── Auto-indexed engineer answers
│
└── Credentials (Vault)
    ├── credential_id, name, description
    └── Encrypted value (never in PostgreSQL, never exposed to AI)
```

**Why Generic Integrations?**
- Everything is just code + secrets at the end of the day
- No need to pre-define integration types (git, db, api, etc.)
- Coding Agent generates the right code based on knowledge/docs
- Supports any service: SaaS APIs, internal tools, custom protocols, CLI tools, etc.
- New integration types don't require code changes

**Context Retrieval for New Workflows:**
When a user requests a new workflow, the Orchestrator:
1. Searches similar workflows by embedding similarity
2. Matches request against integration descriptions to find relevant ones
3. Retrieves linked knowledge for matched integrations
4. Searches broader knowledge base for additional context
5. Gathers credential references (not values) for needed integrations
6. Passes all context to the Coding Agent

### 2.6 Agent Communication Protocol

The Coding Agent can request additional context from the Orchestrator mid-generation:

```
┌─────────────────┐                      ┌─────────────────┐
│   Orchestrator  │                      │  Coding Agent   │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         │  invoke_coding_agent()                 │
         │  Initial Context:                      │
         │  - Workflow requirements               │
         │  - Relevant integrations               │
         │  - Credential refs                     │
         │  - Similar workflow code               │
         │  - Knowledge base excerpts             │
         │───────────────────────────────────────►│
         │                                        │
         │                                        │  Coding Agent starts
         │                                        │  generating code...
         │                                        │
         │  request_context(type, query)          │
         │  "Need schema for 'orders' table"      │
         │◄───────────────────────────────────────│
         │                                        │
         │  Orchestrator:                         │
         │  - Searches knowledge base             │
         │  - If not found, asks engineer         │
         │  - Caches answer for future            │
         │                                        │
         │  Context Response:                     │
         │  { schema: "CREATE TABLE orders..." }  │
         │───────────────────────────────────────►│
         │                                        │
         │                                        │  Continues generating
         │                                        │  with new context
         │                                        │
         │  Workflow Complete                     │
         │  { setup.py, run.py, workflow.json }   │
         │◄───────────────────────────────────────│
```

**Context Request Types:**
| Type | Description |
|------|-------------|
| `integration_info` | Get details about an integration (credentials, knowledge) |
| `knowledge` | Search knowledge base for docs, schemas, examples, rules |
| `credential` | Request an additional credential reference |
| `clarification` | Ambiguous requirement needing user/engineer input |

Since integrations are generic, the Coding Agent requests information by describing what it needs, and the Orchestrator searches the knowledge base and integrations to find relevant context.

### 2.7 Execution Environment

**Sandbox Options:**
- **Firecracker microVMs** - Strongest isolation (recommended for production)
- **gVisor containers** - Lighter weight for lower-risk workloads

**Security Features:**
- Isolated filesystem per execution
- Network egress whitelist only (ideally derived from integrations + explicit per-workflow allowlist)
- Resource limits (CPU, memory, time)
- Pre-installed runtimes (Python, Node.js)
- FlowPal SDK injected for secure credential access

**Credential handling clarity (important):**
- Workflow packages contain **credential references only** (e.g. `cred:stripe-api-key`), never raw secrets.
- At execution time, the sandbox manager resolves credential refs and injects them into the sandbox (commonly as env vars or a local ephemeral credentials file).
- `flowpal-sdk` helpers like `sdk.get_credential("cred:...")` read from that injected runtime store. This keeps secrets out of AI prompts, code artifacts, and databases.

#### Two-Phase Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FIRST EXECUTION                               │
├─────────────────────────────────────────────────────────────────────┤
│  1. Provision fresh sandbox (Firecracker/gVisor)                    │
│  2. Mount workflow package from S3                                   │
│  3. Inject FlowPal SDK                                               │
│  4. Resolve credentials → set as environment variables              │
│                         │                                            │
│                         ▼                                            │
│  5. Run setup.py                                                     │
│     - Clones repos, installs deps, downloads files                  │
│     - Workspace now fully prepared                                   │
│                         │                                            │
│                         ▼                                            │
│  6. Snapshot workspace (if persist_workspace: true)                 │
│     - Stored in S3 as workspace_{workflow_id}.tar.gz                │
│                         │                                            │
│                         ▼                                            │
│  7. Run run.py                                                       │
│     - Actual workflow logic executes                                 │
│     - Logs streamed via WebSocket                                    │
│                         │                                            │
│                         ▼                                            │
│  8. Capture results, destroy sandbox                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     SUBSEQUENT EXECUTIONS                            │
├─────────────────────────────────────────────────────────────────────┤
│  If persist_workspace: true AND snapshot exists:                    │
│  1. Provision sandbox from snapshot (skip setup.py)                 │
│  2. Inject fresh credentials                                         │
│  3. Run run.py directly                                              │
│  4. Capture results, destroy sandbox                                 │
│                                                                      │
│  If persist_workspace: false OR no snapshot:                        │
│  1. Full flow (setup.py → run.py)                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Workspace Snapshot Management:**
- Snapshots invalidated when workflow code is updated
- Optional manual "rebuild workspace" trigger for dependency updates
- Snapshots are tenant-isolated (stored under tenant's S3 prefix)

---

## 3. AI Agent Tools

### Orchestrator Agent Tools

| Tool | Purpose |
|------|---------|
| `invoke_coding_agent` | Generate workflow code (setup.py + run.py) using OpenCode |
| `find_similar_workflows` | Search for reusable existing workflows by embedding similarity |
| `ask_engineer` | Request help for missing information (async, notifies via Slack/email) |
| `search_knowledge` | Query the organization's knowledge base |
| `get_credential_reference` | Get a credential reference ID to pass to the coding agent |
| `search_integrations` | Search tenant's integrations by description/name (returns matching integrations with their credential refs and linked knowledge) |
| `web_search` | Search the web for information (e.g., API docs, library usage) |
| `fetch_url` | Fetch a URL and return the content |

**Important:** The Orchestrator never directly queries user databases or makes HTTP requests to user APIs. It only gathers context and invokes the Coding Agent.

### Coding Agent Tools (within OpenCode)

| Tool | Purpose |
|------|---------|
| `request_context` | Ask Orchestrator for additional information mid-generation |
| `read_file` | Read files in the isolated workspace |
| `write_file` | Write setup.py, run.py, and other workflow files |
| `shell` | Execute shell commands in the isolated container |
| Standard OpenCode tools | LSP, file operations, etc. |

**`request_context` Usage:**

Since integrations are generic, the Coding Agent describes what it needs in natural language:

```
request_context({
  query: "I need the schema for the 'orders' table in the production database"
})

request_context({
  query: "How do I authenticate with the internal ML service?"
})

request_context({
  query: "What's the Slack channel ID for the finance team notifications?"
})
```

The Orchestrator then:
1. Searches the knowledge base and integrations for relevant info
2. If found, returns the context
3. If not found, asks an engineer (async) and caches the answer

This natural language approach means:
- No need to pre-define context types
- Works with any integration, even custom/internal ones
- Knowledge accumulates over time as engineers answer questions

---

## 4. Communication System

### Engineer Question Flow

When the AI needs information it doesn't have:

1. AI identifies missing info (credentials, schema, API details)
2. Creates a question in the system
3. Notifies engineers via Slack, email, and in-app
4. Engineer answers with option to save to knowledge base
5. AI resumes workflow creation with the answer
6. Knowledge persisted for future similar requests

### Workflow Approval Flow

Separate from “answering AI questions,” engineers also act as a **human safety gate** for newly created workflows.

1. User requests a new workflow in natural language
2. Orchestrator + Coding Agent produce `setup.py`, `run.py`, `workflow.json`
3. Workflow version is saved as **pending_approval**
4. Engineers are notified (Slack/email/in-app) with a link to review
5. Engineer reviews and can **edit** `setup.py` / `run.py`
6. Engineer approves → version becomes **published**, and triggers are enabled
7. All actions are audited (who changed what, when, and why)

**Policy edge cases to define:**
- Who can approve (any Engineer vs a subset / “Approver”)?
- Do workflow updates require re-approval? (recommended: **yes**)
- Can Users run a workflow while pending approval? (recommended: **no**, except an explicit “test run” initiated by an Engineer)

### Real-Time Updates

- WebSocket connections for live execution status
- Progress indicators during workflow creation
- Log streaming during execution

---

## 5. Tech Stack

### Backend
| Component | Technology |
|-----------|------------|
| API Framework | Hono (TypeScript) |
| Runtime | Bun |
| Database | PostgreSQL + pgvector |
| Cache/Queue | Redis + BullMQ |
| Real-time | Socket.IO |
| Coding Agent | OpenCode Server |
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
| Secrets | HashiCorp Vault or AWS Secrets Manager |
| Storage | S3-compatible |
| Monitoring | Prometheus + Grafana |

---

## 6. Security Model

```
Layer 1: Network      - WAF, rate limiting, DDoS protection
Layer 2: Auth         - JWT tokens, RBAC, org-scoped permissions
Layer 3: Data         - PostgreSQL RLS, tenant context, audit logs
Layer 4: Credentials  - Envelope encryption, per-tenant keys
Layer 5: Execution    - Firecracker isolation, egress whitelist
Layer 6: AI Safety    - Prompt injection detection, code scanning
```

---

## 7. Data Flow: Creating a Workflow

```
1. User: "Create workflow to clone our data-pipelines repo,
         check Stripe for failed payments, and notify finance on Slack"
                    |
                    v
2. Orchestrator: Analyze request, gather context
   - Search tenant's integrations: git repos, APIs, databases
   - Search similar workflows (pgvector)
   - Search knowledge base for relevant schemas, docs
   - Gather credential REFERENCES (not values)
   - NOTE: Orchestrator does NOT access external systems directly
                    |
                    v
3. Missing information?
   - Yes → Ask engineer (async), wait for response
   - No → Continue
                    |
                    v
4. Orchestrator invokes Coding Agent (OpenCode)
   - Passes: requirements, integrations, credential refs, knowledge context
   - Coding Agent may request_context() for additional info mid-generation
   - Orchestrator fetches from DB/knowledge base and responds
                    |
                    v
5. Coding Agent generates TWO code artifacts:

   setup.py (environment preparation):
   ┌─────────────────────────────────────────────────────┐
   │ from flowpal import sdk                             │
   │                                                     │
   │ # Clone the data-pipelines repo                     │
   │ sdk.git_clone(                                      │
   │     credential_ref="cred:github-pat",               │
   │     repo="github.com/acme/data-pipelines",          │
   │     path="./pipelines"                              │
   │ )                                                   │
   │                                                     │
   │ # Install dependencies                              │
   │ sdk.shell("pip install -r ./pipelines/requirements.txt") │
   └─────────────────────────────────────────────────────┘

   run.py (workflow logic):
   ┌─────────────────────────────────────────────────────┐
   │ from flowpal import sdk                             │
   │ import stripe                                       │
   │                                                     │
   │ stripe.api_key = sdk.get_credential("cred:stripe") │
   │ failed = stripe.PaymentIntent.list(status="failed")│
   │ sdk.http_post(                                      │
   │     credential_ref="cred:slack-webhook",            │
   │     json={"text": f"Found {len(failed)} failures"} │
   │ )                                                   │
   └─────────────────────────────────────────────────────┘
                    |
                    v
6. Validate & store workflow package
   - Security scan both setup.py and run.py
   - Store package in S3: {tenant_id}/workflows/{workflow_id}/
   - Store metadata + embeddings in PostgreSQL
                    |
                    v
7. Engineer approval (required for new workflows)
   - Set version state: pending_approval
   - Engineer can review + edit setup.py/run.py in UI
   - On approval: mark version published (approved) and enable triggers
                    |
                    v
8. Ready for execution (published workflows only)
```

### Data Flow: Executing a Workflow

```
1. User/system triggers a **published** workflow (manual, scheduled, or webhook)
                    |
                    v
2. Check for workspace snapshot
   - Snapshot exists AND persist_workspace: true? → Skip to step 5
   - Otherwise → Continue to step 3
                    |
                    v
3. Provision fresh sandbox (Firecracker/gVisor)
   - Mount workflow package from S3
   - Inject FlowPal SDK
   - Resolve credentials → environment variables
                    |
                    v
4. Run setup.py (first execution only)
   - Clones repos, installs deps, downloads files
   - Workspace fully prepared
   - Create snapshot if persist_workspace: true
                    |
                    v
5. Run run.py
   - Actual workflow logic executes
   - SDK provides secure access to credentials, APIs, DBs
   - All external access through egress whitelist
   - Logs streamed via WebSocket
                    |
                    v
6. Capture results, destroy sandbox
   - Output stored in execution history
   - Sandbox destroyed (no state leakage)
   - Workspace snapshot retained for next run (if enabled)
```

**Key Points:**
- Orchestrator and Coding Agent are NOT involved during sandbox execution (aside from triggering/queuing runs)
- setup.py runs once (or when snapshot is invalidated)
- run.py runs every execution
- Credentials are resolved at runtime, never stored in code

---

### UI/UX (Workflows & Runs)

The UI should make it easy to **discover existing workflows**, **understand status/ownership**, and **debug runs** quickly.

**Workflows**
- Workflow list: search/filter by status, tags, owner; show last run + last updated + approval status
- Workflow detail: overview, triggers, versions, integrations used, credential refs (names only), recent runs

**Approvals (Engineers)**
- Approval queue: list `pending_approval` workflow versions
- Review screen: `setup.py` / `run.py` / `workflow.json` tabs, diff view, inline editing (Monaco), approve/reject with notes, optional test run

**Executions / Runs**
- Runs list: filter by workflow, status, time range, trigger source (manual/schedule/webhook)
- Run detail: logs (live + final), timeline, inputs/outputs/artifacts, retry/re-run controls (permissioned)

**Integrations (Engineers/Admins)**

Integrations are generic - any external system the org uses:

- Integration list: search by name/description, show linked credentials count, knowledge docs count
- Create/edit integration:
  - Name + description (used for AI matching)
  - Link credentials (select from credential vault)
  - Link knowledge docs (upload docs, paste schemas, add API specs, etc.)
- Integration detail: overview, linked credentials (names only), linked knowledge, workflows using this integration

Example integrations an org might create:
- "Stripe" → credentials: API key, webhook secret; knowledge: Stripe API docs, webhook event schemas
- "Production Postgres" → credentials: connection string; knowledge: table schemas, query examples
- "GitHub" → credentials: PAT; knowledge: repo list, branch conventions
- "Internal CRM API" → credentials: API key, base URL; knowledge: OpenAPI spec, auth flow docs
- "AWS S3 (Data Lake)" → credentials: access key, secret key, region; knowledge: bucket structure, naming conventions

## 8. Project Structure

```
flowpal/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── workflows/
│   │   │   │   ├── executions/
│   │   │   │   ├── approvals/
│   │   │   │   ├── integrations/    # Generic integrations (credentials + knowledge)
│   │   │   │   ├── credentials/
│   │   │   │   └── knowledge/
│   │   └── components/
│   │
│   └── api/                    # Hono/Bun backend
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── agents/
│       │   │   ├── orchestrator/
│       │   │   └── coding/
│       │   ├── tools/
│       │   ├── execution/
│       │   ├── communication/
│       │   └── db/
│
├── packages/
│   ├── flowpal-sdk/            # SDK for sandbox execution
│   └── shared/                 # Shared types
│
├── infra/
│   ├── kubernetes/
│   ├── terraform/
│   └── docker/
│
└── .opencode/                  # OpenCode config
    └── agents/
```

---

## 9. Implementation Phases

| Phase | Focus | Duration |
|-------|-------|----------|
| 1 | Foundation: Multi-tenant DB, auth, basic API | Weeks 1-4 |
| 2 | Core Workflow: CRUD, OpenCode integration, basic sandbox | Weeks 5-8 |
| 3 | AI Agent Layer: Orchestrator, tools, similarity search | Weeks 9-12 |
| 4 | Credentials: Vault, engineer Q&A, notifications | Weeks 13-15 |
| 5 | Hardening: Firecracker, security audit, monitoring | Weeks 16-18 |
| 6 | Advanced: Scheduling, webhooks, versioning, billing | Weeks 19-24 |

---

## 10. Key Design Decisions

### Why Two-Layer Agents?
- **Orchestrator** handles business logic, security, and coordination
- **Coding Agent (OpenCode)** focuses purely on code generation
- Separation of concerns allows swapping coding agent if needed

### Why OpenCode vs Custom Coding Agent?

**Challenge:** OpenCode is single-tenant by design; FlowPal needs multi-tenant isolation.

**Option A: Ephemeral OpenCode Containers (Recommended if using OpenCode)**
```
Tenant A → Spawn container → Workspace: /isolated/{org_a}/{workflow_id}
Tenant B → Spawn container → Workspace: /isolated/{org_b}/{workflow_id}
```
- Each workflow creation gets fresh, isolated OpenCode instance
- Container runs as unprivileged user with minimal capabilities
- Workspace directory mounted only for that tenant's scope
- Instance destroyed after task; no state leakage
- Warm pool of pre-initialized containers reduces startup latency
- Pros: Strong container-level isolation, battle-tested tool
- Cons: Resource overhead, dependency on external project

**Option B: Custom Coding Agent**
- Build from scratch using LLM APIs + custom tool definitions
- Full control over multi-tenant security model
- Can use LangChain/LangGraph or raw API calls
- Pros: No external dependency, designed for multi-tenancy from start
- Cons: Significant development effort, need to build file ops/LSP/shell tools

**Recommendation:** Start with Option A (ephemeral OpenCode containers) for faster MVP. The container isolation provides strong tenant separation. If OpenCode proves limiting, the Orchestrator abstraction allows swapping to a custom agent later without changing the rest of the system.

### Why pgvector for Similarity?
- Single database for relational + vector data
- Proven PostgreSQL reliability
- Simpler ops than separate vector DB
- Good enough for workflow-scale similarity search

### Why Firecracker for Sandboxing?
- AWS-proven technology (used by Lambda)
- Sub-second boot times
- Strong security isolation
- Better than containers for untrusted code

---

## 11. Verification Plan

To verify the architecture works end-to-end:

1. **Auth Flow**: Create org, invite user, assign roles
2. **Credential Storage**: Store a test API key, verify encryption
3. **Integration Setup**: Create generic integration with credentials + knowledge docs (e.g., "Test API" with API key + usage docs)
4. **Workflow Creation**: Submit prompt, verify AI generates setup.py + run.py and correctly references the integration
5. **Context Request**: Trigger Coding Agent to request_context(), verify Orchestrator responds
6. **Engineer Q&A**: Trigger missing info scenario, answer question, verify knowledge base update
7. **Approval Gate**: Create workflow as User, verify it is pending_approval and cannot run
8. **Engineer Edit + Approve**: Edit `setup.py`/`run.py`, approve, verify it becomes runnable and audit trail is correct
9. **First Execution**: Run workflow, verify setup.py runs, workspace snapshot created
10. **Subsequent Execution**: Run again, verify snapshot used (setup.py skipped)
11. **Snapshot Invalidation**: Update workflow code, verify setup.py runs again
12. **Similarity**: Create similar workflow, verify reuse suggestion
13. **UI Coverage**: Verify workflows list + workflow detail + executions list + run detail show correct status, logs, and history

---

## Critical Files to Implement First

1. `apps/api/src/db/schema.sql` - Database schema with RLS (workflows, integrations, knowledge base)
2. `apps/api/src/agents/orchestrator/index.ts` - Main orchestrator with tool definitions
3. `apps/api/src/agents/orchestrator/context-gatherer.ts` - Fetches tenant context for workflow creation
4. `apps/api/src/agents/coding/opencode-client.ts` - OpenCode integration with request_context callback
5. `apps/api/src/services/credential-vault.ts` - Secure credential storage
6. `apps/api/src/services/integration-service.ts` - Generic integration CRUD (name, description, credential refs, linked knowledge)
7. `apps/api/src/execution/sandbox-manager.ts` - Sandbox provisioning with snapshot support
8. `apps/api/src/execution/workspace-snapshot.ts` - Workspace snapshot creation/restoration
9. `packages/flowpal-sdk/src/index.ts` - SDK for setup.py/run.py (shell, get_credential, http helpers, etc.)
