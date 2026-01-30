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
|   Service        |              |  (Kong/Traefik)   |              |                  |
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
                    |              |   Coding Agent    |              |
                    |              |   (Custom/OpenCode)|             |
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
- **Engineer**: Can respond to AI queries, provide credentials, configure integrations, **review/approve workflows**, and **edit workflow code**
- **User**: Can create workflows, request runs, view results (subject to approval and permissions)

### 2.2 Two-Layer AI Agent Architecture

```
+------------------------------------------------------------------+
|                     ORCHESTRATOR AGENT                            |
|  Manages workflow lifecycle, coordinates everything               |
|  DOES NOT directly access user databases or APIs                  |
|                                                                   |
|  - Context Manager        - Invokes Coding Agent                  |
|  - Similarity Search      - Credential Reference Lookup           |
|  - Engineer Communication - Data Layer Management                 |
+------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     CODING AGENT                                  |
|  Generates workflow code that runs in sandbox                     |
|                                                                   |
|  - Code Generation        - File Operations                       |
|  - Uses FlowPal SDK       - Natural Language Context Requests     |
+------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     SANDBOX EXECUTION                             |
|  Generated code runs here with actual system access               |
|                                                                   |
|  - Connects to user databases via FlowPal SDK                     |
|  - Makes HTTP requests to user APIs                               |
|  - Credentials resolved at runtime (never in code)                |
+------------------------------------------------------------------+
```

**Key Separation:**
- **Orchestrator**: Plans and coordinates, but never touches user data directly
- **Coding Agent**: Writes code that *will* access user systems when executed
- **Sandbox**: Where the generated code actually runs and interacts with user systems

**Coding Agent Options:**
- **Option A: Custom Agent** (Recommended) - Build using LLM APIs + custom tool definitions. Full control over multi-tenant security. No external dependency.
- **Option B: OpenCode** - Open source, but requires ephemeral container isolation per tenant. More setup overhead.

The Orchestrator abstraction allows swapping between implementations without changing the rest of the system.

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
- Editing `run.py` creates a **new immutable version** that returns to **pending**.
- Approval metadata stored with the version: `approved_by`, `approved_at`, `approval_notes`.

#### Workflow Package Structure

Each workflow consists of a single code artifact generated by the Coding Agent:

```
Workflow Package (stored in S3)
├── run.py                      ← Workflow logic (generated by Coding Agent)
│   - Environment setup (idempotent - checks before installing)
│   - The actual workflow business logic
│   - Uses FlowPal SDK for credentials, APIs, databases
│   - Outputs structured data via sdk.output()
│
└── workflow.json               ← Metadata
    {
      "display_name": "Check failed Stripe payments",
      "intent_summary": "Lists failed Stripe payments for a given customer/date range and returns a summary for finance review.",
      "runtime": "python3.11",
      "credential_refs": ["cred:stripe", "cred:github-pat"],
      "timeout_seconds": 300,
      "egress_allowlist": ["api.stripe.com", "github.com"],
      "input_schema": {
        "type": "object",
        "properties": {
          "customer_id": { "type": "string", "description": "Stripe customer ID" },
          "date_range": {
            "type": "object",
            "properties": { "days": { "type": "number" } },
            "default": { "days": 7 }
          }
        },
        "required": ["customer_id"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "count": { "type": "number" },
          "payments": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["count", "payments"]
      },
      "side_effects": [
        "Reads Stripe API",
        "No writes performed"
      ]
    }
```

#### Workflow Contract (How the Orchestrator Knows What a Workflow Does)

In v1, FlowPal does **not** try to “understand” arbitrary Python by parsing `run.py`. Instead, every workflow version ships a small **manifest** in `workflow.json` that the Orchestrator and UI treat as the workflow’s contract:

- **`intent_summary`**: a human-readable “what it does” summary (generated by AI, editable by engineers during review)
- **`input_schema`**: JSON Schema describing runtime arguments (used to render the Run form and validate inputs)
- **`output_schema` (optional)**: JSON Schema describing the shape of `sdk.output()` (used to label/render results)
- **`side_effects`**: short list of expected external effects (helps review and safe re-runs)
- **`credential_refs` / `egress_allowlist`**: concrete security and execution constraints (reviewable and enforceable)

**Contract enforcement (simple v1 rule):**
- Workflows may only read runtime arguments via `sdk.get_input(...)`.
- If `input_schema` is present, the API validates inputs before enqueueing a run; missing/invalid inputs fail fast with a clear error.

**Why Single File?**
- **Simplicity**: One file to review, approve, and maintain
- **Idempotent Setup**: Code checks if dependencies are installed before installing
- **Fewer Moving Parts**: No snapshot management, no two-phase execution

**Engineer review/edit surface:**
- Engineers can view and edit `run.py` and `workflow.json` before publishing
- The review UI highlights:
  - **Diff** vs prior version
  - **Credential refs** used (names/IDs only, no secret values)
  - **Network egress** targets
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
- Knowledge entries can optionally link to an integration via `integration_id`

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
│   ├── state: pending | approved | rejected
│   ├── code_package_path (S3 reference to {run.py, workflow.json})
│   ├── approved_by, approved_at, approval_notes (nullable)
│   └── created_by, created_at
│
├── Workflow Data (S3 + PostgreSQL metadata)
│   ├── workflow_id → links to workflow
│   ├── data_path (S3 reference: {tenant_id}/workflow-data/{workflow_id}/)
│   └── keys[] → list of data keys with metadata (size, last_modified)
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
│
└── Credentials (Vault)
    ├── credential_id, name, description
    └── Encrypted value (never in PostgreSQL, never exposed to AI)
```

**Context Retrieval for New Workflows:**
When a user requests a new workflow, the Orchestrator:
1. Searches similar workflows by embedding similarity
2. Matches request against integration descriptions to find relevant ones
3. Retrieves knowledge entries linked to matched integrations
4. Searches broader knowledge base for additional context
5. Gathers credential references (not values) for needed integrations
6. Passes all context to the Coding Agent

### 2.6 Agent Communication Protocol

The Coding Agent can request additional context from the Orchestrator mid-generation using **natural language queries**:

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
         │  request_context(query)                │
         │  "I need the schema for orders table"  │
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
         │  { run.py, workflow.json }             │
         │◄───────────────────────────────────────│
```

**Natural Language Context Requests:**

The Coding Agent describes what it needs in plain language:

```
request_context("I need the schema for the 'orders' table in the production database")
request_context("How do I authenticate with the internal ML service?")
request_context("What's the Slack channel ID for the finance team notifications?")
```

The Orchestrator then:
1. Searches the knowledge base and integrations for relevant info
2. If found, returns the context
3. If not found, asks an engineer (async) and caches the answer

**Why Natural Language?**
- No need to pre-define context types
- Works with any integration, even custom/internal ones
- Knowledge accumulates over time as engineers answer questions

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
│                     WORKFLOW PACKAGE (S3)                            │
│  Immutable code artifacts (require approval to change)              │
│  ├── run.py          ← Reads from data layer via sdk.get_data()     │
│  └── workflow.json                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ sdk.get_data() / sdk.set_data()
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW DATA STORE                              │
│  Mutable data (can be modified without code approval)               │
│                                                                      │
│  Storage: S3 + PostgreSQL metadata                                   │
│  Path: {tenant_id}/workflow-data/{workflow_id}/                      │
│                                                                      │
│  ├── config.json         ← Key-value configuration                   │
│  ├── test_cases.json     ← Array of test case objects               │
│  ├── rules.json          ← Business rules / filters                  │
│  └── {custom_key}.json   ← Any arbitrary data                        │
└─────────────────────────────────────────────────────────────────────┘
```

**SDK Methods for Data Access:**

```python
from flowpal import sdk

# Read data (returns None if key doesn't exist)
test_cases = sdk.get_data("test_cases")
config = sdk.get_data("config", default={"threshold": 100})

# Write data (from within workflow execution)
sdk.set_data("last_run_stats", {"processed": 150, "failed": 3})

# Append to array data (atomic operation)
sdk.append_data("test_cases", {"input": "new test", "expected": "result"})
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
| **AI Agent** | Orchestrator | AI modifies data in response to user requests |
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
- FlowPal SDK injected for secure credential access

**Credential Handling:**
- Workflow packages contain **credential references only**, never raw secrets
- At execution time, the sandbox manager resolves credential refs and injects them as environment variables
- `sdk.get_credential("cred:...")` reads from the injected runtime store

**Execution Flow:**

```
1. Trigger workflow (manual, scheduled, or webhook)
                    |
                    v
2. Provision fresh sandbox (Firecracker/gVisor)
   - Mount workflow package from S3
   - Inject FlowPal SDK
   - Resolve credentials → environment variables
                    |
                    v
3. Run run.py
   - Idempotent setup (install deps if not present)
   - Actual workflow logic executes
   - SDK provides secure access to credentials, APIs, DBs
   - All external access through egress whitelist
   - Logs streamed via WebSocket
   - sdk.output() captures structured results
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
- Payload is passed to workflow as `sdk.get_input("webhook_payload")`
- Authentication via secret token in URL or HMAC signature header

**Runtime Input Parameters:**

Workflows can accept input parameters at execution time:

```python
from flowpal import sdk

# Get input passed at trigger time
customer_id = sdk.get_input("customer_id")
date_range = sdk.get_input("date_range", default={"days": 7})

# Use in workflow logic
orders = fetch_orders(customer_id, date_range)
```

**Input Sources:**
- **Manual runs**: User provides inputs via form in UI
- **Scheduled runs**: Inputs defined in schedule configuration
- **Webhook runs**: Inputs extracted from webhook payload
- **API calls**: Inputs passed in request body

**How inputs are defined (v1):**
- The Coding Agent generates an `input_schema` in `workflow.json` whenever practical.
- The Orchestrator/UI use `input_schema` to:
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

### Orchestrator Agent Tools

| Tool | Purpose |
|------|---------|
| `invoke_coding_agent` | Generate workflow code (run.py) |
| `find_similar_workflows` | Search for reusable existing workflows by embedding similarity |
| `ask_engineer` | Request help for missing information (async, notifies via Slack/email) |
| `search_knowledge` | Query the organization's knowledge base |
| `get_credential_reference` | Get a credential reference ID to pass to the coding agent |
| `search_integrations` | Search tenant's integrations by description/name |
| `get_workflow_data` | Read data from a workflow's data layer |
| `set_workflow_data` | Write/update data in a workflow's data layer |
| `web_search` | Search the web for information (e.g., API docs) |
| `fetch_url` | Fetch a URL and return the content |

**Important:** The Orchestrator never directly queries user databases or makes HTTP requests to user APIs. It only gathers context and invokes the Coding Agent.

### Coding Agent Tools

| Tool | Purpose |
|------|---------|
| `request_context` | Ask Orchestrator for additional information (natural language query) |
| `read_file` | Read files in the isolated workspace |
| `write_file` | Write run.py and other workflow files |
| `shell` | Execute shell commands in the isolated container |
| `get_workflow_data` | Read existing workflow data |
| `set_workflow_data` | Write initial workflow data alongside code |

**Data Access: Orchestrator vs Coding Agent**

| Agent | When | Use Case |
|-------|------|----------|
| **Orchestrator** | Before invoking Coding Agent | Inspect data to decide if code change is needed vs data-only change |
| **Orchestrator** | After user request | Directly modify data without Coding Agent (e.g., "add this test case") |
| **Coding Agent** | During code generation | Read existing data structure to generate compatible code |
| **Coding Agent** | During workflow creation | Write initial data alongside code |

---

## 4. User Interface & API

### How Users Interact with the Orchestrator

**Chat Interface:**
- Users interact with FlowPal through a chat-like interface in the web app
- Natural language requests are sent to the Orchestrator Agent
- The Orchestrator responds with status updates, questions, or completed workflows

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
- `question`: Orchestrator needs clarification
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
2. Orchestrator + Coding Agent produce `run.py`, `workflow.json`
3. Workflow version is saved as **pending**
4. Engineers are notified with a link to review
5. Engineer reviews and can **edit** `run.py`
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
| Secrets | HashiCorp Vault or AWS Secrets Manager |
| Storage | S3-compatible |
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
- Tenant-isolated (same RLS as other data)
- Cannot contain raw credentials (only refs)
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
2. Orchestrator: Analyze request, gather context
   - Search tenant's integrations (finds "Stripe" integration)
   - Search similar workflows (pgvector)
   - Search knowledge base for relevant docs
   - Gather credential REFERENCES (not values)
                    |
                    v
3. Missing information?
   - Yes → Ask engineer (async), wait for response
   - No → Continue
                    |
                    v
4. Orchestrator invokes Coding Agent
   - Passes: requirements, integrations, credential refs, knowledge context
   - Coding Agent may request_context() for additional info
   - Orchestrator fetches from knowledge base and responds
                    |
                    v
5. Coding Agent generates workflow:

   run.py:
   ┌─────────────────────────────────────────────────────┐
   │ from flowpal import sdk                             │
   │ import stripe                                       │
   │                                                     │
   │ # Idempotent setup                                  │
   │ sdk.ensure_package("stripe")                        │
   │                                                     │
   │ # Get credentials securely                          │
   │ stripe.api_key = sdk.get_credential("cred:stripe")  │
   │                                                     │
   │ # Workflow logic                                    │
   │ failed = stripe.PaymentIntent.list(status="failed") │
   │                                                     │
   │ # Output results                                    │
   │ sdk.output({                                        │
   │     "count": len(failed.data),                      │
   │     "payments": [format(p) for p in failed.data]    │
   │ })                                                  │
   └─────────────────────────────────────────────────────┘
                    |
                    v
6. Validate & store workflow package
   - Security scan run.py for dangerous patterns
   - Store package in S3: {tenant_id}/workflows/{workflow_id}/
   - Store metadata + embeddings in PostgreSQL
                    |
                    v
7. Engineer approval (required)
   - Set version state: pending
   - Engineer can review + edit run.py in UI
   - On approval: mark version approved, enable triggers
                    |
                    v
8. Ready for execution
```

### Executing a Workflow

```
1. Trigger (manual, scheduled, or webhook with optional inputs)
                    |
                    v
2. Provision sandbox (Firecracker/gVisor)
   - Mount workflow package from S3
   - Inject FlowPal SDK
   - Resolve credentials → environment variables
   - Pass inputs via sdk.get_input()
                    |
                    v
3. Run run.py
   - Idempotent setup (install deps if needed)
   - Workflow logic executes
   - Logs streamed via WebSocket
   - sdk.output() captures results
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

## 10. Project Structure

```
flowpal/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── workflows/
│   │   │   │   ├── executions/
│   │   │   │   ├── approvals/
│   │   │   │   ├── integrations/
│   │   │   │   ├── credentials/
│   │   │   │   └── knowledge/
│   │   ├── components/
│   │   │   └── results-viewer/     # JSON tree, auto-table, log viewer
│   │   └── lib/
│   │
│   └── api/                    # Hono/Bun backend
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   │   ├── workflow-data/
│       │   │   └── audit/          # Unified audit logging
│       │   ├── agents/
│       │   │   ├── orchestrator/
│       │   │   └── coding/
│       │   ├── execution/
│       │   ├── triggers/           # Scheduling, webhooks
│       │   └── db/
│
├── packages/
│   ├── flowpal-sdk/            # SDK for sandbox execution
│   └── shared/                 # Shared types
│
└── infra/
    ├── kubernetes/
    ├── terraform/
    └── docker/
```

---

## 11. Implementation Phases

| Phase | Focus |
|-------|-------|
| 1 | Foundation: Multi-tenant DB, auth, basic API |
| 2 | Core Workflow: CRUD, Coding Agent integration, basic sandbox |
| 3 | AI Agent Layer: Orchestrator, tools, similarity search |
| 4 | Credentials: Vault, engineer Q&A, notifications |
| 5 | Triggers: Scheduling, webhooks, input parameters |
| 6 | Hardening: Firecracker, security audit, monitoring |

---

## 12. Key Design Decisions

### Why Two-Layer Agents?
- **Orchestrator** handles business logic, security, and coordination
- **Coding Agent** focuses purely on code generation
- Separation of concerns allows swapping coding agent implementation

### Why Custom Coding Agent over OpenCode?
- Full control over multi-tenant security model
- No external dependency to maintain
- Simpler deployment (no container-per-tenant overhead)
- OpenCode can be used later if custom agent proves limiting

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

## 13. Future Enhancements

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

## 14. Verification Plan

To verify the architecture works end-to-end:

1. **Auth Flow**: Create org, invite user, assign roles
2. **Credential Storage**: Store a test API key, verify encryption
3. **Integration Setup**: Create integration with credentials
4. **Knowledge Base**: Add knowledge entry linked to integration
5. **Workflow Creation**: Submit prompt, verify AI generates run.py
6. **Context Request**: Trigger Coding Agent to request_context(), verify Orchestrator responds
7. **Engineer Q&A**: Trigger missing info scenario, answer question, verify knowledge base update
8. **Approval Gate**: Create workflow as User, verify it is pending and cannot run
9. **Engineer Approve**: Approve workflow, verify it becomes runnable
10. **Manual Execution**: Run workflow, verify logs stream, results captured
11. **Scheduled Execution**: Create schedule, verify workflow runs on time
12. **Webhook Execution**: POST to webhook URL, verify workflow runs with payload
13. **Input Parameters**: Run with inputs, verify sdk.get_input() works
14. **Workflow Contract**: Verify `intent_summary` + `input_schema` are present and used (run form + validation)
15. **Similarity**: Create similar workflow, verify reuse suggestion
16. **Workflow Data Layer**: Create workflow with data, verify sdk.get_data() works
17. **Data Modification via AI**: Ask AI to "add a test case", verify data updates without code change
18. **Error Handling**: Force a failure, verify retry and notifications
19. **Audit Trail**: Verify all actions logged in unified audit system

---

## 15. Critical Files to Implement First

1. `apps/api/src/db/schema.sql` - Database schema with RLS
2. `apps/api/src/agents/orchestrator/index.ts` - Main orchestrator with tool definitions
3. `apps/api/src/agents/orchestrator/context-gatherer.ts` - Fetches tenant context
4. `apps/api/src/agents/coding/agent.ts` - Custom coding agent implementation
5. `apps/api/src/services/credential-vault.ts` - Secure credential storage
6. `apps/api/src/services/audit/index.ts` - Unified audit logging service
7. `apps/api/src/execution/sandbox-manager.ts` - Sandbox provisioning
8. `apps/api/src/triggers/scheduler.ts` - Cron-based scheduling
9. `apps/api/src/triggers/webhook.ts` - Webhook handler
10. `packages/flowpal-sdk/src/index.ts` - SDK (get_credential, get_input, get_data, output)
11. `apps/web/components/results-viewer/` - JSON tree, auto-table, log viewer
12. `apps/api/src/services/workflow-data/data-store.ts` - Workflow data layer
