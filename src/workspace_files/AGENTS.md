# LocalTool Agent Instructions

This document is your operating manual for working within this directory (called workspace). Follow these conventions strictly when creating, updating, or running workflows and custom skills.

---

## Required Decision Order (ALWAYS FOLLOW)

For every user request, follow this exact sequence:

1. **Look for a relevant custom skill first** using `findSkill` (and `listAvailableSkills` when needed).
2. **If no suitable skill is found**, look for a relevant workflow using `findSimilarWorkflow` (and `listAvailableWorkflows` when needed).
3. **If neither exists**, then consider creation:
   - Create a new skill using `createSkill` when the need is reusable instruction logic.
   - Create a new workflow using `createWorkflow` when executable automation is needed.

Do NOT skip this sequence.

---

## ⚠️ CRITICAL: Never Run Scripts Directly

**You must NEVER execute workflow scripts directly using shell commands.**

All workflow execution performed by the agent **must** go through the `runWorkflow` tool. This is enforced because:
- Only workflows that have been **approved by an engineer user** can be executed. This check (among other checks) is performed by the `runWorkflow` tool.
- The `runWorkflow` can throw an error for various reasons. If it does, read the error message and report it to the user accurately.

Workflows must still be fully executable end-to-end by the platform tooling (given correct deps + env), but direct Python/Node execution is not allowed (except the explicit `.venv` creation command described below).

**Forbidden actions (for the agent):**
- ❌ `python run.py`
- ❌ `cd workflows/xxx && python run.py`
- ❌ `python3 run.py`, `python3.x run.py`, `python2 run.py`, `py run.py`, `pypy run.py`
- ❌ `/usr/bin/python ...`, `/usr/bin/python3 ...`, `.venv/bin/python ...`, `env python ...`, `env python3 ...`
- ❌ `python -m ...`, `python3 -m ...`, `py -m ...` (including module-based launch paths), **except** creating a workflow-local virtualenv with `python -m venv .venv` or `python3 -m venv .venv`
- ❌ Any alias, symlink, wrapper, or alternative interpreter invocation that executes Python code
- ❌ `node script.js`, `nodejs script.js`, `npx node ...`, `/usr/bin/node ...`
- ❌ `node -e ...`, `node --eval ...`, `node -p ...` (including eval/inline execution)
- ❌ Any alias, symlink, wrapper, or alternative interpreter invocation that executes Node.js code
- ❌ Any shell command that runs a workflow script

**Required action:**
- ✅ Use the `runWorkflow` tool to execute any workflow
- ✅ After `createWorkflow`, immediately create `workflows/<slug>/.venv` using `python -m venv .venv` (or `python3 -m venv .venv`) from inside that workflow folder

**Allowed shell commands (only for setup, never for running workflow scripts):**
- ✅ `cd workflows/<slug> && python -m venv .venv`
- ✅ `cd workflows/<slug> && python3 -m venv .venv`

Violating this constraint bypasses safety checks and is not permitted.

---

## Section 1: Custom Skills

Before implementing custom instructions or creating new workflow logic, you MUST first check whether an existing custom skill can fulfill the request.

**Required skill tools:**
- `listAvailableSkills` — list only skills you are allowed to use (editable + approved).
- `findSkill` — semantically search skills by description/body.
- `getSkillContent` — read `SKILL.md` for a specific skill (only works when user has access and skill is approved).
- `createSkill` — create a new skill when no suitable skill exists. This tool requires explicit user permission during execution.

**Rule:**
- Always try `findSkill` before creating a new skill.
- If a relevant skill exists, use it and follow its `SKILL.md` instructions.
- If no relevant skill exists, use `createSkill`.

---

### What is a Custom Skill?

A **custom skill** is a reusable instruction package for the agent that lives in `custom-skills/<slug>/`.
Each custom skill:
- Has a unique slug (lowercase, hyphenated, e.g., `triage-support-ticket`)
- Uses `SKILL.md` as the canonical manifest/instruction file
- Must be **approved by an engineer user** before it is considered usable via the skill tools
- Must only be used when you have access to it through platform permissions

---

## Section 2: Workflows

### What is a Workflow?

A **workflow** is a self-contained automation package that lives in `workflows/<slug>/`. Each workflow:
- Has a unique slug (lowercase, hyphenated, e.g., `failed-stripe-payments`)
- Is filesystem-first: the folder contents are the source of truth
- Must be self-contained on disk: **any external additions** required by the workflow (e.g., cloned git repos, downloaded SDKs/assets, vendored scripts, fixtures) **must be placed inside** `workflows/<slug>/` and **must not** be created/checked out anywhere outside the workflow folder
- Can be triggered manually via the `runWorkflow` tool (by you) or from the UI (by a human)
- Must be **approved by an engineer user** before it can be executed
- Internally runs through approved platform runtime entrypoints
  - **Agent execution**: must be invoked via `runWorkflow` (never via shell)
  - **Human execution**: must also go through approved platform tooling (no direct Python/Node execution)

---

### Workflow Package Structure

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

### Required Files

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
      "type": "number",
      "required": false,
      "default": 7,
      "description": "Number of days to look back for failed payments"
    }
  },
  "triggers": {
    "manual": true // will always be true.
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
- Not be run directly with Python from shell; execution must happen via approved platform tooling only
- Be end-to-end self-contained: it should perform the full workflow (setup (if needed) + inputs → processing → outputs) in one invocation
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

### Optional Files

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

## Shared Conventions

### Custom Skills: Usage Flow

1. **Search skills first** — You MUST use `findSkill` to look for an existing skill that can satisfy the request before creating new skill logic.
2. **Inspect matching skills** — Use `getSkillContent` to read candidate `SKILL.md` files and decide whether one applies.
3. **Create only when needed** — Use `createSkill` only if no existing approved + accessible skill is a good fit.
4. **Use listing when needed** — Use `listAvailableSkills` when you need a quick inventory of usable skills.

### Workflows: Creating a New Workflow

1. **Check for similar workflows first** — You MUST use the `findSimilarWorkflow` tool to search for existing workflows; do NOT use shell or bash commands (for example `grep`, `rg`, or `find`) to search the repository for workflows.
   - If you find a similar workflow, **learn from it**: take relevant business logic from it.
   - If you only want to find an existing workflow to run (not create a new one), you MUST also use the `findSimilarWorkflow` tool rather than searching with shell commands.
   - Use `listAvailableWorkflows` when you need a quick inventory of all accessible workflows before narrowing down.
2. **Use the `createWorkflow` tool** — This creates the workflow folder with all required files:
   - `slug`: The workflow name (lowercase, hyphens, e.g., `failed-stripe-payments`)
   - `intent_summary`: Description of what the workflow does
   - `inputs`: (optional) Input parameter schema
   - `timeout_seconds`: (optional, default 300) Max execution time
3. **Create the virtual environment immediately** — Right after `createWorkflow`, create a workflow-local virtualenv:
   - `cd workflows/<slug> && python -m venv .venv` (or `python3 -m venv .venv`)
4. **Implement the workflow** — After the tool creates the skeleton and `.venv`:
   - Edit `run.py` — Implement the logic with argparse for inputs
   - Edit `requirements.txt` — Add Python dependencies (no version specifiers)
   - Edit `.env` — Add runtime secrets
   - Edit `.env.example` — Document required secrets as a template
   - Edit `README.md` — Document the workflow
   - Create `.venv/` — Create a per-workflow virtualenv
   - Update `requirements.lock.txt` — Run `pip freeze > requirements.lock.txt` after installing deps
5. **Optionally create `data/`** — If the workflow needs to persist state between runs (document structure in README)

### Workflows: Updating an Existing Workflow

1. **Read the current files** — Understand existing logic before modifying
2. **Re-check the workflow slug** — If you want to change what `run.py` does, you MUST ensure the workflow folder slug (the `workflows/<slug>/` name) is still apt for the workflow’s purpose. If it no longer fits, consider finding a more appropriate existing workflow or creating a new workflow with a better slug instead of overloading the old one.
3. **Modify the `run.py` file** to implement the desired functionality.
4. **Preserve the contract** — If changing inputs/outputs, update `workflow.json`
5. **Keep `workflow.json` aligned with behavior** — If you modify `run.py`, you MUST also update the `intent_summary` in `workflow.json` to match the new/updated behavior.
6. **Update documentation** — Keep `README.md` in sync with changes
7. **Test locally if possible** — Run the workflow to verify changes

### Workflows: Running Workflows

If you simply need to find an existing workflow to run (and are not creating a new workflow), use `findSimilarWorkflow` (and `listAvailableWorkflows` when useful) to locate it; do NOT search using shell commands.

**⚠️ CRITICAL: Never run workflows directly via shell commands. Always use the `runWorkflow` tool.**

- Workflows are executed via the `runWorkflow` tool (NOT via shell commands)
- The tool checks if the workflow is approved before execution
- If not approved, the tool returns an error — you cannot bypass this.
- Outputs are captured and returned by the tool
- Each workflow has its own `.venv/` virtualenv (managed by the execution environment)
- Dependencies are installed from `requirements.txt` (always latest versions) and recorded in `requirements.lock.txt`

### Workflows: Credential Handling

- Store secrets in `.env`
- Always provide `.env.example` with placeholder values
- Document which secrets are required in `README.md`

### Workflows: Output and Artifacts

- Write outputs to the console (stdout/stderr) — this is captured by the `runWorkflow` tool
- Use structured formats (JSON) for machine-readable output when appropriate

---

### Workflows: Input Handling

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

## Shared Best Practices

1. **Never run scripts directly with Python or Node** — Always use the `runWorkflow` tool or other approved platform tooling
2. **Always check for existing skills first** — you MUST try `findSkill` and check whether a custom skill can fulfill the request before creating new workflow logic.
3. **Always check for existing workflows** before creating new ones — you MUST use the `findSimilarWorkflow` tool to do this. Use `listAvailableWorkflows` if you need a full inventory first. Only create new ones if no existing workflow can fit the request. If needed, modify the existing workflow to fit the request WITHOUT losing older functionality.
   - If you find a similar workflow, **study it and follow its business logic and conventions**.
4. **Ask the user for help** when unsure.
   - When asking the user questions, ask **just one question at a time**.
5. **Keep workflows focused** — one workflow, one purpose
6. **Document thoroughly** — future you (and others) will thank you
7. **Handle errors gracefully** — workflows should fail cleanly
8. **Be idempotent** — workflows may be retried; design for it
9. **Respect rate limits** — add appropriate delays for API calls
10. **Log meaningfully** — include context in log messages
11. **Don’t outgrow the slug** — If you want to change `run.py` meaningfully, re-check that the workflow slug is still apt; otherwise choose/create a workflow whose slug matches the intent.
12. **Keep the intent contract current** — Any change to `run.py` requires updating `workflow.json` `intent_summary` accordingly.
13. **Keep dependencies/artifacts inside the workflow folder** — If you must add external files (e.g., clone a repo, vendor code, download fixtures), put them under `workflows/<slug>/` and never outside it.

---

## Workflows: Error Handling and Retries

- Design workflows to be idempotent when possible
- Document idempotency expectations in `README.md`

---

## Security & Scope Restrictions (MUST FOLLOW)

These rules exist to prevent data loss, secret leakage, and unsafe behavior. Violations are not permitted.

### Scope limitation (workflows and custom skills)

- Primary execution scope remains **creating, managing, and running workflows and custom skills** in this workspace.
- You MAY also handle user requests for requirement gathering, discovery, analysis, and explanation that reference files outside the workspace.
- For such out-of-workspace requests, treat access as **read-only context gathering** unless the user explicitly asks for broader actions.

### Never delete workflows

- You must **NEVER delete a workflow** (folders or files under `workflows/<slug>/`).
- Workflow deletions are only supposed to happen via the **UI**.
- If cleanup is requested, prefer **deprecating** (e.g., update README/status/intent) rather than deleting anything.

### Never delete custom skills

- You must **NEVER delete a custom skill** (folders or files under `custom-skills/<slug>/`).
- Custom skill deletions are only supposed to happen via the **UI**.
- If cleanup is requested, prefer **deprecating** or updating skill instructions rather than deleting anything.

### Approval & execution integrity

- Never attempt to bypass workflow approval requirements.
- Never attempt to bypass custom-skill approval requirements.
- Never use `getSkillContent` output from unapproved skills to drive execution decisions.

### Secrets & sensitive data handling

- Assume the agent can access sensitive files (including workflow `.env` files and skill content).
- Never print, log, or exfiltrate secrets or credentials.
- Do not copy `.env` contents into chat output; redact secrets in any logs/output you produce.
- Do not ask users to paste secrets into chat; instruct them to set secrets in the workflow’s `.env` (and document them in `.env.example`).
- Only store workflow runtime secrets in `.env`. Never store secrets in `README.md`, `workflow.json`, `requirements.txt`, `requirements.lock.txt`, `data/`, or `SKILL.md`.

### Filesystem safety boundaries

- You MAY read files outside managed workspace areas when needed to understand user requirements, gather context, or answer questions.
- Keep any cloned repos, downloaded assets, fixtures, or vendored code **inside** `workflows/<slug>/` only.
- Keep skill artifacts and instruction files inside `custom-skills/<slug>/` only.

### No destructive shell actions

- Do not run destructive commands that could delete or corrupt workflows, custom skills, or workspace state (for example `rm`, `rm -rf`, or scripted deletions).
- When changes are needed, prefer additive edits; avoid irreversible operations.

---

## Example: Creating a New Workflow

When asked to "Create a workflow that checks Stripe for failed payments":

1. Use the `findSimilarWorkflow` tool to check for existing payment-related workflows — do NOT search using shell commands (e.g., `grep`, `rg`, `find`).
2. If no match, use the `createWorkflow` tool:
   ```
   createWorkflow({
     slug: "failed-stripe-payments",
     intent_summary: "Checks Stripe for failed payments for a given customer",
     inputs: {
       customer_id: { type: "string", required: true, description: "The Stripe customer ID" },
       days_back: { type: "number", required: false, default: 7, description: "Days to look back" }
     }
   })
   ```
3. Implement the workflow files:
   - Edit `run.py` — Implement Stripe API logic with argparse for inputs
   - Edit `requirements.txt` — Add `stripe` dependency (no version specifier)
   - Edit `.env` — Add `STRIPE_API_KEY` (never commit)
   - Edit `.env.example` — Template with `STRIPE_API_KEY=sk_test_...`
   - Create `.venv/` immediately after `createWorkflow` — run `cd workflows/failed-stripe-payments && python -m venv .venv` (or `python3 -m venv .venv`)
   - Update `requirements.lock.txt` — Run `pip freeze > requirements.lock.txt` after installing
   - Edit `README.md` — Document usage and required secrets
4. If unsure about Stripe API details, ask the user for help or search the web using your tools.
5. **Do NOT run the workflow directly** — inform the user that the workflow needs an engineer's approval before it can be executed via `runWorkflow`

## Example: Running an Existing Workflow

When asked to "Run the failed-stripe-payments workflow for customer cus_123":

1. **DO NOT** run `python run.py`, `node script.js`, or any shell command
2. **DO NOT** run any Python interpreter command (`python`, `python3`, `python3.x`, `py`, `pypy`, absolute/interpreter-path variants, or `-m` module invocations)
3. **DO NOT** run any Node interpreter command (`node`, `nodejs`, absolute/interpreter-path variants, or `-e`/`--eval`/`-p` inline execution)
4. Use the `runWorkflow` tool.
5. If the workflow is not approved, inform the user about the error and that they need to wait for an engineer's approval
6. If the workflow runs successfully, report the output to the user

## Example: Finding a workflow to run
When the user does not specify a workflow to run, you MUST use the `findSimilarWorkflow` tool to find a workflow to run. You may use `listAvailableWorkflows` first when you need to quickly inspect all accessible options. For example, if the user asks "How many users do I have in my app?"

1. **DO NOT** search using shell commands (for example `grep`, `rg`, or `find`) to search the repository for workflows.
2. Use the `findSimilarWorkflow` tool with an argument like "Count number of users in the app", which will return a list of similar workflows based on semantic similarity to the query.
3. Inspect each workflow's workflow.json and README.md to determine if it is the correct workflow to run. If unclear, ask the user for clarification.
4. Once you have found the correct workflow, run it using the `runWorkflow` tool.
5. If no relevant workflow found, then inform the user and ask them if you should create a new workflow to handle the request.

## Example: Listing Available Workflows

When you need a quick inventory before semantic search or selection:

1. Use `listAvailableWorkflows` to get all accessible workflows.
2. If needed, then use `findSimilarWorkflow` to rank by semantic relevance.
3. Choose the best candidate and proceed with `runWorkflow` (or update/create flow as needed).

## Example: Finding and Using a Skill

When a user asks for behavior that may already be captured as reusable instructions:

1. Use `findSkill` with a natural-language query for the needed capability.
2. For promising matches, use `getSkillContent` to inspect `SKILL.md`.
3. If a skill fits, follow that skill's instructions.
4. If no approved + accessible skill fits, ask whether to create one and then use `createSkill`.

## Example: Creating a New Skill

When asked to create a reusable skill:

1. Use `findSkill` first to avoid duplicates.
2. Optionally use `listAvailableSkills` if you need a full inventory before selecting a candidate.
3. If no good match exists, use `createSkill` with:
   - `slug`
   - `description`
   - markdown `content`
4. Approve the permission prompt when asked during `createSkill` execution.
5. Inform the user that the new skill must be engineer-approved before it becomes generally usable through skill lookup flows.
