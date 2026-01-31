# FlowPal Agent Instructions

This document is your operating manual for working within this directory (called workspace). Follow these conventions strictly when creating, updating, or running workflows.

---

## What is a Workflow?

A **workflow** is a self-contained automation package that lives in `workflows/<slug>/`. Each workflow:
- Has a unique slug (lowercase, hyphenated, e.g., `failed-stripe-payments`)
- Is filesystem-first: the folder contents are the source of truth
- Can be triggered manually (either by you or a human)
- Runs with `python run.py {optional args}` from within its folder

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
├── requirements.lock.txt  ← REQUIRED: pinned deps for reproducibility
├── data/                  ← OPTIONAL: non-secret config/state files
└── runs/                  ← OPTIONAL: run outputs/logs (local artifacts)
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
    "python_version": "3.11", // can be a different one as well depending on which version is installed in the system.
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

List all Python dependencies. Be specific with versions for reproducibility.

```
stripe>=5.0.0
requests>=2.28.0
```

---

## Conventions

### Creating a New Workflow

1. **Check for similar workflows first** — Use the `findSimilarWorkflow` tool to avoid duplicating effort
2. **Create the folder** — `workflows/<slug>/`
3. **Create all required files**:
   - `workflow.json` — Define the contract
   - `README.md` — Document the workflow
   - `run.py` — Implement the logic
   - `requirements.txt` — List dependencies
   - `.env` — Add runtime secrets (never commit)
   - `.venv/` — Create a per-workflow virtualenv
   - `requirements.lock.txt` — Pin exact dependency versions
4. **Create `.env.example`** — Document all required secrets as a template

### Updating an Existing Workflow

1. **Read the current files** — Understand existing logic before modifying
2. **Preserve the contract** — If changing inputs/outputs, update `workflow.json`
3. **Update documentation** — Keep `README.md` in sync with changes
4. **Test locally if possible** — Run the workflow to verify changes

### Running Workflows

- Workflows run from their folder with `python run.py {optional args}`
- Outputs are written to the console (stdout/stderr)
- Each workflow has its own `.venv/` virtualenv
- Dependencies are installed from `requirements.txt` and pinned in `requirements.lock.txt`

### Credential Handling

- Store secrets in `.env
- Always provide `.env.example` with placeholder values
- Document which secrets are required in `README.md`

### Output and Artifacts

- Write outputs to the console (stdout/stderr)
- Use structured formats (JSON) for machine-readable output when appropriate
- Optionally write artifacts to `runs/` if file output is needed

---

## Input Handling

Inputs are passed as command-line arguments to `run.py`. Use `argparse` to parse them:

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

Run the workflow with:
```bash
python run.py --customer_id cus_123 --days_back 14
```

---

## Available Tools

The following tools are available in `./tools/` for your use:

### `findSimilarWorkflow`

Use to discover existing workflows that might be reusable or adaptable.

**Behavior:**
- Queries the workflow database using semantic similarity
- Returns up to N candidate workflows with paths and summaries
- Helps avoid duplicate work

**When to use:**
- Before creating a new workflow
- When the user's request seems similar to existing functionality
- To find patterns or code to reuse

**Example usage:**
```bash
./tools/findSimilarWorkflow --description "Check Stripe for failed payments and notify via Slack" --limit 3
```

**Example response:**
```json
{
  "matches": [
    {
      "path": "workflows/stripe-payment-alerts",
      "similarity": 0.89,
      "summary": "Monitors Stripe payments and sends Slack notifications for failures"
    },
    {
      "path": "workflows/payment-retry-notifier",
      "similarity": 0.72,
      "summary": "Retries failed payments and emails customers"
    }
  ]
}
```

---

## Best Practices

1. **Always check for existing workflows** before creating new ones. Only create new ones if no existing workflow can fit the request. If needed, modify the existing workflow to fit the request WITHOUT loosing older functionality.
2. **Ask for help** when unsure — use your tools to ask help from an engineer.
3. **Keep workflows focused** — one workflow, one purpose
4. **Document thoroughly** — future you (and others) will thank you
5. **Handle errors gracefully** — workflows should fail cleanly
6. **Be idempotent** — workflows may be retried; design for it
7. **Respect rate limits** — add appropriate delays for API calls
8. **Log meaningfully** — include context in log messages

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

1. Run `findSimilarWorkflow` to check for existing payment-related workflows
2. If no match, create `workflows/failed-stripe-payments/`
3. Create all required files:
   - `workflow.json` — Define inputs (customer_id, days_back) and runtime config
   - `run.py` — Implement Stripe API logic with argparse for inputs
   - `requirements.txt` — Add `stripe` dependency
   - `requirements.lock.txt` — Pin exact versions after installing
   - `.env` — Add `STRIPE_API_KEY` (never commit)
   - `.env.example` — Template with `STRIPE_API_KEY=sk_test_...`
   - `.venv/` — Create virtualenv with `python -m venv .venv`
   - `README.md` — Document usage and required secrets
4. If unsure about Stripe API details, use your tools to ask an engineer, or search the web etc.
