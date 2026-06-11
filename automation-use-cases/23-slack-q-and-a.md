# Slack Question And Answer

## Goal

Someone tags a Slack bot with a question. The bot starts a TeamCopilot workflow. That workflow either answers directly, or asks the right teammate on Slack, waits for their Slack-thread reply, and finally posts the answer back in the original Slack thread.

This is one hosted Slack ingress service plus one workflow. The service only handles Slack event ingress and starts the workflow. The workflow owns the actual Q&A process.

## Primitives

- Hosted service: receives Slack Events API callbacks, verifies Slack signatures, dedupes events, and starts the workflow.
- Workflow: selects an expert, sends the expert DM, waits for the expert's Slack reply, and posts the final answer back.
- Workflow data directory: records run history and Slack thread correlation for debugging.
- `tc.call_workflow`: lets the Slack service start the workflow from the webhook path.
- `search_users`: used by the agent to find the best TeamCopilot user based on name, email, role, title, and profile description.
- `tc.run_agent`: decides whether the question can be answered and, if not, uses `search_users` to choose an expert.
- `tc.success` / `tc.fail`: records the terminal workflow result.

## Resources

```text
services/slack-q-and-a-ingress/
  service.json
  server.py
  data/seen_events.json

workflows/answer-slack-question/
  workflow.json
  run.py
  data/run_history.json
```

## Why There Is A Service And A Workflow

Slack expects Events API requests to be acknowledged quickly. The service receives the `app_mention`, verifies it, dedupes it, starts a background workflow call, and immediately returns `{"ok": true}` to Slack.

The workflow can take longer. It sends Slack messages, polls the expert DM thread for a reply, and posts the result back to the original thread.

## Correlation Model

The workflow stores Slack references for the full lifecycle:

```json
{
  "question_id": "q_123",
  "original_channel": "C123",
  "original_thread_ts": "1710000000.000100",
  "expert_slack_user_id": "U456",
  "expert_dm_channel": "D789",
  "expert_prompt_ts": "1710000002.000300"
}
```

The workflow polls Slack `conversations.replies` for the expert DM thread. A message counts as the answer only if:

- it is in the stored `expert_dm_channel`
- it belongs to the thread whose `thread_ts` is `expert_prompt_ts`
- it was sent by the selected `expert_slack_user_id`
- it is not a bot message

That prevents unrelated Slack DMs from completing the question.

## `services/slack-q-and-a-ingress/service.json`

```json
{
  "name": "Slack Q&A Ingress",
  "runtime": "python",
  "entrypoint": "server.py",
  "port": 7120,
  "public_path": "/services/slack-q-and-a",
  "required_secrets": [
    "SLACK_SIGNING_SECRET"
  ]
}
```

## `services/slack-q-and-a-ingress/server.py`

```python
import hashlib
import hmac
import json
import os
import re
import threading
import time
from pathlib import Path

from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

data_dir = Path("data")
data_dir.mkdir(parents=True, exist_ok=True)
seen_path = data_dir / "seen_events.json"


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True))


def verify_slack_signature(raw_body):
    timestamp = request.headers["X-Slack-Request-Timestamp"]
    if abs(time.time() - int(timestamp)) > 60 * 5:
        raise ValueError("stale Slack request")

    base = b"v0:" + timestamp.encode() + b":" + raw_body
    expected = "v0=" + hmac.new(
        os.environ["SLACK_SIGNING_SECRET"].encode(),
        base,
        hashlib.sha256,
    ).hexdigest()
    provided = request.headers["X-Slack-Signature"]
    if not hmac.compare_digest(expected, provided):
        raise ValueError("invalid Slack signature")


def seen_event(event_id):
    payload = load_json(seen_path, {"event_ids": []})
    if event_id in payload["event_ids"]:
        return True
    payload["event_ids"].append(event_id)
    payload["event_ids"] = payload["event_ids"][-1000:]
    save_json(seen_path, payload)
    return False


def strip_bot_mention(text):
    return re.sub(r"<@[^>]+>", "", text).strip()


def start_answer_workflow(event):
    question = strip_bot_mention(event["text"])
    original_thread_ts = event.get("thread_ts") or event["ts"]
    tc.call_workflow("answer-slack-question", {
        "question": question,
        "requester_slack_user_id": event["user"],
        "original_channel": event["channel"],
        "original_thread_ts": original_thread_ts,
        "source_event_ts": event["ts"],
    })


@app.post("/slack/events")
def slack_events():
    raw_body = request.get_data()
    verify_slack_signature(raw_body)
    body = request.json

    if body.get("type") == "url_verification":
        return {"challenge": body["challenge"]}

    event_id = body.get("event_id")
    if event_id and seen_event(event_id):
        return {"ok": True, "duplicate": True}

    event = body["event"]
    if event["type"] == "app_mention" and not event.get("bot_id"):
        threading.Thread(target=start_answer_workflow, args=(event,), daemon=True).start()

    return {"ok": True}
```

## `workflows/answer-slack-question/workflow.json`

```json
{
  "name": "Answer Slack Question",
  "intent_summary": "Answers a Slack question directly or asks the best expert on Slack and posts the answer back to the original thread.",
  "inputs": {
    "question": {"type": "string", "required": true},
    "requester_slack_user_id": {"type": "string", "required": true},
    "original_channel": {"type": "string", "required": true},
    "original_thread_ts": {"type": "string", "required": true},
    "source_event_ts": {"type": "string", "required": true}
  },
  "required_secrets": ["SLACK_BOT_TOKEN"],
  "runtime": {"timeout_seconds": 86400}
}
```

## `workflows/answer-slack-question/run.py`

```python
import argparse
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from teamcopilot import tc


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True))


def slack_api(method, payload):
    response = requests.post(
        f"https://slack.com/api/{method}",
        headers={"Authorization": f"Bearer {os.environ['SLACK_BOT_TOKEN']}"},
        json=payload,
        timeout=20,
    )
    response.raise_for_status()
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError(f"Slack API error for {method}: {body}")
    return body


def post_message(channel, text, thread_ts=None):
    payload = {"channel": channel, "text": text}
    if thread_ts:
        payload["thread_ts"] = thread_ts
    body = slack_api("chat.postMessage", payload)
    return body["ts"]


def open_dm(slack_user_id):
    body = slack_api("conversations.open", {"users": slack_user_id})
    return body["channel"]["id"]


def find_expert_reply(dm_channel, prompt_ts, expert_slack_user_id):
    body = slack_api("conversations.replies", {
        "channel": dm_channel,
        "ts": prompt_ts,
        "limit": 20,
    })
    for message in body["messages"]:
        if message["ts"] == prompt_ts:
            continue
        if message.get("bot_id") or message.get("subtype"):
            continue
        if message.get("user") == expert_slack_user_id:
            return message
    return None


def append_history(entry):
    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)
    history_path = data_dir / "run_history.json"
    payload = load_json(history_path, {"runs": []})
    payload["runs"].append(entry)
    save_json(history_path, payload)


parser = argparse.ArgumentParser()
parser.add_argument("--question", required=True)
parser.add_argument("--requester_slack_user_id", required=True)
parser.add_argument("--original_channel", required=True)
parser.add_argument("--original_thread_ts", required=True)
parser.add_argument("--source_event_ts", required=True)
args = parser.parse_args()

data_dir = Path("data")
question_id = "q_" + uuid.uuid4().hex

decision = tc.run_agent(f"""
Answer this Slack question if the provided context is enough.
Otherwise use the search_users tool to find the best TeamCopilot user to ask.

Question:
{args.question}

Only set can_answer=true if the answer is specific and does not require guessing.
Only choose a human if search_users returns a user with a linked Slack user id.
Prefer users whose title or description shows ownership of the area in the question.
""", schema={
    "type": "object",
    "required": ["can_answer", "answer", "expert_user_id", "expert_slack_user_id", "expert_reason"],
    "properties": {
        "can_answer": {"type": "boolean"},
        "answer": {"type": "string"},
        "expert_user_id": {"type": ["string", "null"]},
        "expert_slack_user_id": {"type": ["string", "null"]},
        "expert_reason": {"type": "string"},
    },
})["data"]

if decision["can_answer"]:
    post_message(args.original_channel, decision["answer"], thread_ts=args.original_thread_ts)
    result = {"question_id": question_id, "answer_source": "agent", "answer": decision["answer"]}
    append_history({"at": now_iso(), "question": args.question, "result": result})
    tc.success(result)

expert_slack_user_id = decision["expert_slack_user_id"]
expert_user_id = decision["expert_user_id"]
dm_channel = open_dm(expert_slack_user_id)
prompt = f"""Question from <@{args.requester_slack_user_id}>:

{args.question}

You were selected because: {decision['expert_reason']}

Please reply in this thread with the answer. I will post it back to the original Slack thread."""
prompt_ts = post_message(dm_channel, prompt)

post_message(
    args.original_channel,
    f"I asked <@{expert_slack_user_id}> and will reply here when they answer.",
    thread_ts=args.original_thread_ts,
)

append_history({
    "at": now_iso(),
    "question_id": question_id,
    "question": args.question,
    "original_channel": args.original_channel,
    "original_thread_ts": args.original_thread_ts,
    "expert_user_id": expert_user_id,
    "expert_slack_user_id": expert_slack_user_id,
    "expert_dm_channel": dm_channel,
    "expert_prompt_ts": prompt_ts,
    "status": "waiting_for_expert",
})

deadline = time.time() + 23 * 60 * 60
while time.time() < deadline:
    reply = find_expert_reply(dm_channel, prompt_ts, expert_slack_user_id)
    if reply:
        answer = reply["text"]
        post_message(
            args.original_channel,
            f"Answer from <@{expert_slack_user_id}>:\n\n{answer}",
            thread_ts=args.original_thread_ts,
        )
        result = {
            "question_id": question_id,
            "answer_source": "slack_expert",
            "answer": answer,
            "expert_user_id": expert_user_id,
            "expert_slack_user_id": expert_slack_user_id,
            "expert_reason": decision["expert_reason"],
        }
        append_history({"at": now_iso(), "question": args.question, "result": result})
        tc.success(result)

    time.sleep(60)

post_message(
    args.original_channel,
    f"I asked <@{expert_slack_user_id}> but did not get an answer within 23 hours.",
    thread_ts=args.original_thread_ts,
)
tc.fail(f"No Slack answer from {expert_slack_user_id} within timeout.")
```

## Slack App Configuration

The Slack app should subscribe to:

- `app_mention`: someone tags the bot in a channel.

The workflow polls the expert DM thread through Slack Web API, so the Events API does not need `message.im` for this version.

The app needs bot scopes:

- `app_mentions:read`
- `chat:write`
- `im:write`
- `im:history`

Slack Event Request URL:

```text
https://<teamcopilot-host>/services/slack-q-and-a/slack/events
```

## Flow

```text
user tags Slack bot with a question
  -> Slack calls service /slack/events with app_mention
  -> service verifies Slack signature and dedupes event_id
  -> service starts answer-slack-question workflow in a background thread
  -> service immediately acknowledges Slack
  -> workflow calls tc.run_agent
  -> agent uses search_users if a human expert is needed
  -> agent returns selected TeamCopilot user id and linked Slack user id
  -> if answer is known, workflow posts in original Slack thread
  -> otherwise workflow opens DM with selected expert
  -> workflow posts the question in the expert DM
  -> workflow polls that DM thread for the selected expert's reply
  -> expert replies in the DM thread
  -> workflow posts the answer back in the original Slack thread
  -> workflow succeeds with the final answer
```

## Why This Is Correlated Correctly

- The original Slack channel and thread timestamp are passed into the workflow.
- The expert is selected from TeamCopilot users returned by `search_users`.
- The workflow stores the expert DM channel and prompt timestamp.
- A reply only counts if it comes from the selected expert in the exact DM thread.
- Slack request signatures prove the original app mention came from Slack.
- Slack `event_id` dedupe prevents duplicate workflows from Slack retries.

## Tradeoffs

- This keeps the expert conversation in Slack only, which is what this use case wants.
- The workflow may run for hours while polling Slack. That is acceptable for this example because the workflow runtime timeout is explicit.
- If long-running polling becomes too expensive, convert expert replies to a `message.im` webhook and let the service resume a stored pending question instead.
