# Workflow Conditional Bug Investigation

Run a reusable bug investigation workflow where the investigation agent asks a teammate only if it needs human context.

This is a workflow because the team wants a repeatable automation package that can be run from chat, a cronjob, or another workflow. The conditional "ask this user if needed" is handled inside the spawned agent session using the agent-facing `askUser` tool.

## Goal

Investigate a bug from the codebase, summarize the likely cause, and ask the billing owner only if the agent determines that billing-specific context is required.

## Primitives

- Workflow: reusable finite automation package.
- `tc.run_agent`: starts the investigation agent and waits for a structured final result.
- `askUser`: used by the spawned agent only if it needs teammate input.
- `answer_user_request`: used by the teammate's agent to send structured input back to the blocked investigation agent.
- `tc.success` / `tc.fail`: return the workflow result.

## Resources

```text
workflows/investigate-bug-conditionally/
  workflow.json
  run.py
```

## `workflows/investigate-bug-conditionally/workflow.json`

```json
{
  "name": "Investigate Bug Conditionally",
  "intent_summary": "Investigate a bug and let the agent ask a teammate only if human context is needed.",
  "inputs": {
    "bug_report": {"type": "string", "required": true},
    "human_owner_user_id": {"type": "string", "required": true},
    "human_owner_label": {"type": "string", "required": true}
  },
  "required_secrets": [],
  "runtime": {"timeout_seconds": 1800}
}
```

## `workflows/investigate-bug-conditionally/run.py`

```python
import argparse
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--bug_report", required=True)
parser.add_argument("--human_owner_user_id", required=True)
parser.add_argument("--human_owner_label", required=True)
args = parser.parse_args()

result = tc.run_agent(
    instruction=f"""
    Investigate this bug from the current codebase.

    Bug report:
    {args.bug_report}

    You may inspect files, search the codebase, and run safe targeted commands.

    If you need domain-specific context from {args.human_owner_label}, call the askUser tool.

    Use this target user:
    {args.human_owner_user_id}

    Only ask the user if their answer is necessary to complete the investigation.
    If you ask them, include the current findings, the exact question, and why the answer is needed.

    Return the final structured result after the investigation is complete.
    """,
    schema={
        "type": "object",
        "required": [
            "summary",
            "asked_human",
            "human_answer_summary",
            "final_diagnosis",
            "recommended_next_steps"
        ],
        "properties": {
            "summary": {"type": "string"},
            "asked_human": {"type": "boolean"},
            "human_answer_summary": {"type": ["string", "null"]},
            "final_diagnosis": {"type": "string"},
            "recommended_next_steps": {
                "type": "array",
                "items": {"type": "string"}
            }
        }
    }
)

tc.success(result["data"])
```

## Agent Handoff Tool Call

If the spawned investigation agent needs human context, it calls:

```ts
askUser({
  user_id: "user_billing_owner",
  instruction_to_agent: `
    Ask the billing owner this question for an active bug investigation.

    Current findings:
    - Invoice sync retries when external_customer_id is missing.
    - The failing staging records appear to be migrated billing accounts.

    Question:
    For migrated billing accounts, should external_customer_id already be populated before invoice sync runs?
    If not, what fallback identifier should invoice sync use?

    Return the user's answer and confidence.
  `,
  schema: {
    type: "object",
    required: ["answer", "confidence"],
    properties: {
      answer: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] }
    }
  }
})
```

TeamCopilot blocks the investigation agent session while the teammate answers. Once the teammate's agent calls `answer_user_request`, TeamCopilot appends the structured answer into the investigation agent session, and the investigation agent continues toward the schema required by `tc.run_agent`.

## Flow

```text
workflow starts with bug_report and human_owner_user_id
  -> workflow calls tc.run_agent once
  -> spawned agent investigates the codebase
  -> if no human context is needed, agent returns final structured result
  -> if human context is needed, agent calls askUser
  -> target user's agent asks the question
  -> target user replies
  -> answer_user_request returns structured data to the blocked investigation agent
  -> investigation agent continues
  -> tc.run_agent returns the final structured result to the workflow
  -> workflow calls tc.success
```

## Why This Belongs In A Workflow

Use this shape when the investigation is reusable, auditable, or triggered by another automation. The workflow does not need to know the exact condition for asking a human. The spawned agent owns that judgment and uses `askUser` only when needed.
