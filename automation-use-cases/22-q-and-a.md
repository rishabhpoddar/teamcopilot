# Question And Answer

## Goal

A user asks the agent a question. The agent answers directly when it has enough context. If it cannot answer confidently, it finds the right teammate, asks that person, waits for their answer, and then replies back to the original user.

This is a chat-agent plus one workflow flow. The chat agent owns the first decision and user search. The workflow owns the durable execution once a human expert must be asked.

## Primitives

- Normal chat agent: receives the original user question.
- `search_resources`: searches workflows, skills, and local resources that might already answer the question.
- `search_users`: finds the right person when the answer requires human knowledge.
- `runWorkflow`: starts the approved `answer-team-question` workflow from chat.
- Workflow: tries a bounded agent answer and asks the selected teammate only if needed.
- `tc.run_agent`: checks whether the question can be answered from provided context.
- `tc.ask_user`: asks the selected teammate and blocks until they answer.
- `tc.success` / `tc.fail`: returns the final answer to the chat agent.

## Resources

```text
workflows/answer-team-question/
  workflow.json
  run.py
  data/question_history.json
```

## Chat Agent Behavior

When the user asks a question, the chat agent follows this sequence:

1. Search existing resources with `search_resources`.
2. If the answer is clear from local context, answer directly in chat.
3. If the answer requires a person, call `search_users` with a role/name/domain query.
4. Pick the best matching teammate and start `answer-team-question` using `runWorkflow`.
5. When the workflow returns, summarize the answer back to the original user and include who answered it.

Example user request:

```text
Do we support SAML JIT provisioning for enterprise customers?
```

Example chat-agent tool calls:

```text
search_resources({
  kind: "workflow",
  query: "SAML JIT provisioning enterprise customers"
})

search_users({
  query: "identity auth enterprise SAML"
})

runWorkflow({
  slug: "answer-team-question",
  inputs: {
    "question": "Do we support SAML JIT provisioning for enterprise customers?",
    "requester_user_id": "user_requester",
    "expert_user_id": "user_identity_lead",
    "expert_reason": "Owns enterprise identity and SAML behavior",
    "local_context": "No approved workflow or skill gave a definitive answer."
  }
})
```

## `workflows/answer-team-question/workflow.json`

```json
{
  "name": "Answer Team Question",
  "intent_summary": "Answers a team question directly when possible, otherwise asks a selected teammate and returns their answer.",
  "inputs": {
    "question": {
      "type": "string",
      "required": true,
      "description": "The original question from the requester"
    },
    "requester_user_id": {
      "type": "string",
      "required": true,
      "description": "The user id of the person who asked the original question"
    },
    "expert_user_id": {
      "type": "string",
      "required": true,
      "description": "The user id of the teammate to ask if local context is insufficient"
    },
    "expert_reason": {
      "type": "string",
      "required": true,
      "description": "Why this teammate was selected"
    },
    "local_context": {
      "type": "string",
      "required": false,
      "default": "",
      "description": "Context gathered by the chat agent before starting the workflow"
    }
  },
  "required_secrets": [],
  "runtime": {"timeout_seconds": 86400}
}
```

## `workflows/answer-team-question/run.py`

```python
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from teamcopilot import tc


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def append_history(entry):
    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)
    history_path = data_dir / "question_history.json"
    if history_path.exists():
        payload = json.loads(history_path.read_text())
    else:
        payload = {"questions": []}
    payload["questions"].append(entry)
    history_path.write_text(json.dumps(payload, indent=2, sort_keys=True))


parser = argparse.ArgumentParser()
parser.add_argument("--question", required=True)
parser.add_argument("--requester_user_id", required=True)
parser.add_argument("--expert_user_id", required=True)
parser.add_argument("--expert_reason", required=True)
parser.add_argument("--local_context", default="")
args = parser.parse_args()

local_answer = tc.run_agent(f"""
You are deciding whether a team question can be answered from the provided context.

Question:
{args.question}

Context already gathered by the chat agent:
{args.local_context}

Return JSON:
{{
  "can_answer": true|false,
  "answer": "the answer if known",
  "confidence": "high|medium|low",
  "reason": "why you can or cannot answer"
}}

Only set can_answer=true if the answer is specific, actionable, and does not require guessing.
""")

if local_answer["can_answer"] and local_answer["confidence"] == "high":
    result = {
        "answer_source": "local_context",
        "answer": local_answer["answer"],
        "expert_user_id": None,
        "expert_reason": None,
        "requester_user_id": args.requester_user_id,
    }
    append_history({"at": now_iso(), "question": args.question, "result": result})
    tc.success(result)

expert_answer = tc.ask_user(
    f"""
Ask this teammate the question below and return their final answer.

Original requester user id:
{args.requester_user_id}

Why this teammate was selected:
{args.expert_reason}

Question:
{args.question}

Context gathered so far:
{args.local_context}

Ask for a concrete answer. If they are not the right person, ask them to name the better owner if they know one, then return that as part of the answer.
""",
    user_id=args.expert_user_id,
)

result = {
    "answer_source": "human_expert",
    "answer": expert_answer,
    "expert_user_id": args.expert_user_id,
    "expert_reason": args.expert_reason,
    "requester_user_id": args.requester_user_id,
}
append_history({"at": now_iso(), "question": args.question, "result": result})
tc.success(result)
```

## Resume Behavior

The workflow does not need a state-machine argument format.

When it calls `tc.ask_user`, the Python process waits while TeamCopilot creates an `automation_user_requests` row and opens or reuses an agent chat with the selected expert. Once the expert replies, the agent calls `answer_user_request`, the SDK polling call returns `expert_answer`, and the workflow continues from the same line.

## Final Chat Response

When `runWorkflow` returns, the chat agent replies to the original requester with the workflow result.

Example:

```text
I checked the existing context and asked the identity owner.

Answer: Yes, SAML JIT provisioning is supported for enterprise customers, but only when domain verification is complete and the customer enables default-role assignment.
Source: human_expert user_identity_lead
```

## Flow

```text
user asks question in chat
  -> chat agent searches resources
  -> chat agent answers directly if confident
  -> otherwise chat agent searches users for the right owner
  -> chat agent runs answer-team-question workflow with expert_user_id
  -> workflow tries one bounded local agent answer
  -> workflow calls tc.ask_user if local answer is not enough
  -> selected expert answers in their agent chat
  -> answer_user_request resumes the workflow
  -> workflow succeeds with final answer
  -> chat agent relays the answer to the original requester
```

## Why This Works

- The chat agent does not need a direct user-interrupt tool.
- The only human handoff happens inside the workflow through `tc.ask_user`.
- The selected `expert_user_id` is explicit and auditable.
- The workflow transcript is visible later because workflow-run agent transcripts must be inspectable in the UI.
- The `data/question_history.json` file is optional convenience history, not required resume state.
