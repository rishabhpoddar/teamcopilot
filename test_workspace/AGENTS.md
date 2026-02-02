# FlowPal Agent Instructions

This document is your operating manual for working within this directory (called workspace). Follow these conventions strictly when creating, updating, or running workflows.

---

## ⚠️ CRITICAL: Never Run Scripts Directly

**You must NEVER execute workflow scripts directly using shell commands.**

All workflow execution **must** go through the `runWorkflow` tool. This is enforced because:
- Only workflows that have been **approved by an admin user** can be executed
- The `runWorkflow` tool checks approval status before execution
- If a workflow is not approved, `runWorkflow` will return an error

**Forbidden actions:**
- ❌ `python run.py`
- ❌ `cd workflows/xxx && python run.py`
- ❌ Any shell command that runs a workflow script

**Required action:**
- ✅ Use the `runWorkflow` tool to execute any workflow

Violating this constraint bypasses safety checks and is not permitted.

---

## What is a Workflow?

A **workflow** is a self-contained automation package that lives in `workflows/<slug>/`. Each workflow:
- Has a unique slug (lowercase, hyphenated, e.g., `failed-stripe-payments`)
- Is filesystem-first: the folder contents are the source of truth
- Can be triggered manually via the `runWorkflow` tool (by you) or from the UI (by a human)
- Must be **approved by an admin user** before it can be executed
- Internally runs with `python run.py {optional args}` (but you must use `runWorkflow`, not shell commands)

---

## Workflow Package Structure

Every workflow folder must follow this structure:

```
workflows/<slug>/
├── workflow.json          ← REQUIRED: contract + runtime metadata
├── README.md              ← REQUIRED: documentation + usage instructions
├── run.py                 ← REQUIRED: entrypoint script
├── requirements.txt       ← REQUIRED: Python dependencies
├── .env                   ← REQUIRED: runtime secrets
├── .env.example           ← RECOMMENDED: documented template
├── .venv/                 ← REQUIRED: per-workflow virtualenv
├── requirements.lock.txt  ← REQUIRED: records installed versions for reference
└── data/                  ← OPTIONAL: non-secret config/state files
```

---

## Required Files

### 1. `workflow.json` — The Workflow Contract

This manifest defines what the workflow does and how it runs. The UI and execution layer use this as the contract.

```json
{
  "intent_summary": "Human-readable description of what this workflow does",
  "inputs": {
    "customer_id": {
      "type": "string",
      "required": true,
      "description": "The Stripe customer ID to check"
    },
    "days_back": {
      "type": "integer",
      "required": false,
      "default": 7,
      "description": "Number of days to look back for failed payments"
    }
  },
  "triggers": {
    "manual": true, // will always be true.
  },
  "runtime": {
    "timeout_seconds": 300
  }
}
```

### 2. `README.md` — Documentation

Document:
- What the workflow does
- Required credentials/secrets
- Input parameters and their meaning
- Expected outputs
- Example usage

### 3. `run.py` — Entrypoint Script

The main script that executes the workflow logic. It must:
- Be runnable via `python run.py`
- Read inputs via args passed to the script.
- Write outputs to to the console.
- Handle errors gracefully

Example:
```python
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer_id", required=True, help="The Stripe customer ID to check")
    parser.add_argument("--days_back", type=int, default=7, help="Number of days to look back")
    args = parser.parse_args()

    # Your workflow logic here

    print(f"Processed customer: {args.customer_id}")

if __name__ == "__main__":
    main()
```

### 4. `requirements.txt` — Dependencies

List all Python dependencies. **Do NOT specify versions** — always use the latest version.

```
stripe
requests
```

**Important:** When adding dependencies:
- Do NOT add version specifiers in `requirements.txt` (e.g., don't use `stripe>=5.0.0`)
- Do NOT use `pip install package==version` — just use `pip install package`
- Always install the latest version available
- After adding any new dependency, you MUST run: `pip freeze > requirements.lock.txt`

### `requirements.lock.txt` — Locked Dependencies

This file records the exact versions of all installed packages. **The only way to modify this file is by running:**

```bash
pip freeze > requirements.lock.txt
```

- Run this command every time you add, remove, or update any dependency
- Never edit this file manually
- This ensures the lock file accurately reflects what's installed in the virtualenv

---

## Optional Files

### `data/` — Workflow State and Configuration

This folder is for storing non-secret state and configuration as JSON files. Use it when your workflow needs to persist data between runs.

**Guidelines:**
- Store state as JSON files (e.g., `last_processed.json`, `cache.json`, `config.json`, `data.json` etc.)
- Structure the folder however fits your workflow's needs
- **Document any data structure in `README.md`** — whenever you add a new file, change the schema of an existing file, or modify the folder structure, update the workflow's README to reflect these changes

**Example structure:**
```
data/
├── last_sync.json       # Timestamp of last successful sync
├── customer_cache.json  # Cached customer data to avoid re-fetching
└── config.json          # Workflow-specific configuration overrides
...
```

**Important:** Always document the purpose and schema of each file in the workflow's `README.md`. This helps future maintainers and AI agents understand what data is being stored and how it's structured.

---

## Conventions

### Creating a New Workflow

1. **Check for similar workflows first** — Use the `findSimilarWorkflow` tool to avoid duplicating effort
   - If you find a similar workflow, **learn from it**: take relevant business logic from it.
   - If you find a similar workflow that can form a sub part of your new workflow, you may **reuse it directly**: consider calling the existing workflow from your new workflow (instead of duplicating logic) when the existing workflow already does most of what you need.
2. **Create the folder** — `workflows/<slug>/`
3. **Create all required files**:
   - `workflow.json` — Define the contract
   - `README.md` — Document the workflow
   - `run.py` — Implement the logic
   - `requirements.txt` — List dependencies
   - `.env` — Add runtime secrets (never commit)
   - `.venv/` — Create a per-workflow virtualenv
   - `requirements.lock.txt` — Record installed dependency versions
4. **Create `.env.example`** — Document all required secrets as a template
5. **Optionally create `data/`** — If the workflow needs to persist state between runs (document structure in README)

### Updating an Existing Workflow

1. **Read the current files** — Understand existing logic before modifying
2. **Re-check the workflow slug** — If you want to change what `run.py` does, you MUST ensure the workflow folder slug (the `workflows/<slug>/` name) is still apt for the workflow’s purpose. If it no longer fits, consider finding a more appropriate existing workflow or creating a new workflow with a better slug instead of overloading the old one.
3. **Modify the `run.py` file** to implement the desired functionality.
4. **Preserve the contract** — If changing inputs/outputs, update `workflow.json`
5. **Keep `workflow.json` aligned with behavior** — If you modify `run.py`, you MUST also update the `intent_summary` in `workflow.json` to match the new/updated behavior.
6. **Update documentation** — Keep `README.md` in sync with changes
7. **Test locally if possible** — Run the workflow to verify changes

### Running Workflows

**⚠️ CRITICAL: Never run workflows directly via shell commands. Always use the `runWorkflow` tool.**

- Workflows are executed via the `runWorkflow` tool (NOT via shell commands)
- The tool checks if the workflow is approved before execution
- If not approved, the tool returns an error — you cannot bypass this
- Outputs are captured and returned by the tool
- Each workflow has its own `.venv/` virtualenv (managed by the execution environment)
- Dependencies are installed from `requirements.txt` (always latest versions) and recorded in `requirements.lock.txt`

### Credential Handling

- Store secrets in `.env
- Always provide `.env.example` with placeholder values
- Document which secrets are required in `README.md`

### Output and Artifacts

- Write outputs to the console (stdout/stderr) — this is captured by the `runWorkflow` tool
- Use structured formats (JSON) for machine-readable output when appropriate

---

## Input Handling

When **writing** workflow code, inputs are passed as command-line arguments to `run.py`. Use `argparse` to parse them:

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--customer_id", required=True, help="The Stripe customer ID")
parser.add_argument("--days_back", type=int, default=7, help="Days to look back")
args = parser.parse_args()

# Access inputs
customer_id = args.customer_id
days_back = args.days_back
```

---

## Best Practices

1. **Never run scripts directly** — Always use the `runWorkflow` tool to execute workflows
2. **Always check for existing workflows** before creating new ones. Only create new ones if no existing workflow can fit the request. If needed, modify the existing workflow to fit the request WITHOUT losing older functionality.
   - If you find a similar workflow, **study it and follow its business logic and conventions**.
   - If an existing workflow can be reused as a sub part of your new workflow, call it directly as opposed to duplicating logic.
3. **Ask the user for help** when unsure.
4. **Keep workflows focused** — one workflow, one purpose
5. **Document thoroughly** — future you (and others) will thank you
6. **Handle errors gracefully** — workflows should fail cleanly
7. **Be idempotent** — workflows may be retried; design for it
8. **Respect rate limits** — add appropriate delays for API calls
9. **Log meaningfully** — include context in log messages
10. **Don’t outgrow the slug** — If you want to change `run.py` meaningfully, re-check that the workflow slug is still apt; otherwise choose/create a workflow whose slug matches the intent.
11. **Keep the intent contract current** — Any change to `run.py` requires updating `workflow.json` `intent_summary` accordingly.

---

## Error Handling and Retries

- Design workflows to be idempotent when possible
- Document idempotency expectations in `README.md`

---

## Security Notes

- The agent has access to workspace files, including `.env` files
- Be cautious with secrets
- Never log or print secrets

---

## Example: Creating a New Workflow

When asked to "Create a workflow that checks Stripe for failed payments":

1. Use the `findSimilarWorkflow` tool to check for existing payment-related workflows
2. If no match, create `workflows/failed-stripe-payments/`
3. Create all required files:
   - `workflow.json` — Define inputs (customer_id, days_back) and runtime config
   - `run.py` — Implement Stripe API logic with argparse for inputs
   - `requirements.txt` — Add `stripe` dependency (no version specifier)
   - `requirements.lock.txt` — Record installed versions after installing
   - `.env` — Add `STRIPE_API_KEY` (never commit)
   - `.env.example` — Template with `STRIPE_API_KEY=sk_test_...`
   - `.venv/` — Create virtualenv with `python -m venv .venv`
   - `README.md` — Document usage and required secrets
4. If unsure about Stripe API details, ask the user for help or search the web using your tools.
5. **Do NOT run the workflow directly** — inform the user that the workflow needs admin approval before it can be executed via `runWorkflow`

## Example: Running an Existing Workflow

When asked to "Run the failed-stripe-payments workflow for customer cus_123":

1. **DO NOT** run `python run.py` or any shell command
2. Use the `runWorkflow` tool.
3. If the workflow is not approved, inform the user about the error and that they need to wait for admin approval
4. If the workflow runs successfully, report the output to the user
