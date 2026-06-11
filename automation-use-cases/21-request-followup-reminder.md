# Request Follow-Up Reminder

## Goal

Ask someone for missing information, automatically follow up until they answer, and notify the requester when the answer arrives.

This uses one hosted service plus one small scheduled workflow. The hosted service owns request state and email/webhook handling. The scheduled workflow exists only to wake the service up on a timer.

## Primitives

- Hosted service: creates requests, sends emails, receives inbound email webhooks, and notifies the requester.
- Cronjob: runs the reminder trigger workflow every 4 hours.
- Workflow: calls the service's protected `/internal/remind-pending` endpoint.
- Service data directory: stores pending requests, reply tokens, reminder counts, and event history.
- `tc.run_agent`: drafts the original request email.

## Resources

```text
services/info-request-reminder/
  service.json
  server.py
  data/pending_requests.json
  data/request_events.json

workflows/trigger-info-request-reminders/
  workflow.json
  run.py

cronjob:
  name: Info request reminder
  target_type: workflow
  workflow_slug: trigger-info-request-reminders
  workflow_inputs: {}
  cron_expression: "0 */4 * * *"
  timezone: "UTC"
```

## Reply Correlation

The service does not accept arbitrary `/reply` calls.

Instead, it sends every request email with a unique reply address:

```text
Reply-To: requests+<request_id>.<reply_token>@inbound.example.com
```

The email provider, such as Postmark, Mailgun, or SendGrid Inbound Parse, is configured to POST inbound replies to:

```text
POST /email-inbound
```

The service verifies the provider signature, extracts `request_id` and `reply_token` from the recipient address, checks that the token matches the stored request, and checks that the reply came from the original target email. Only then does it mark the request answered.

## `services/info-request-reminder/service.json`

```json
{
  "name": "Info Request Reminder",
  "runtime": "python",
  "entrypoint": "server.py",
  "port": 7110,
  "public_path": "/services/info-request-reminder",
  "required_secrets": [
    "EMAIL_API_URL",
    "EMAIL_API_TOKEN",
    "EMAIL_FROM",
    "INBOUND_EMAIL_DOMAIN",
    "INBOUND_EMAIL_WEBHOOK_SECRET",
    "REMINDER_CRON_TOKEN",
    "SLACK_API_URL",
    "SLACK_API_TOKEN"
  ]
}
```

## `services/info-request-reminder/server.py`

```python
import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from email.utils import parseaddr
from pathlib import Path

import requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

data_dir = Path("data")
data_dir.mkdir(parents=True, exist_ok=True)
pending_path = data_dir / "pending_requests.json"
events_path = data_dir / "request_events.json"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def load_pending():
    return load_json(pending_path, {"requests": []})


def save_pending(payload):
    save_json(pending_path, payload)


def record_event(event_type, payload):
    events = load_json(events_path, {"events": []})
    events["events"].append({"type": event_type, "at": now_iso(), "payload": payload})
    save_json(events_path, events)


def verify_hmac_header(raw_body, header_name, secret):
    provided = request.headers.get(header_name, "")
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(provided, expected):
        raise ValueError("invalid signature")


def send_email(to_email, subject, body, reply_to):
    response = requests.post(
        os.environ["EMAIL_API_URL"] + "/send",
        headers={"Authorization": f"Bearer {os.environ['EMAIL_API_TOKEN']}"},
        json={
            "from": os.environ["EMAIL_FROM"],
            "to": to_email,
            "subject": subject,
            "body": body,
            "reply_to": reply_to,
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def send_slack_message(channel, text):
    response = requests.post(
        os.environ["SLACK_API_URL"] + "/messages",
        headers={"Authorization": f"Bearer {os.environ['SLACK_API_TOKEN']}"},
        json={"channel": channel, "text": text},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def reply_address(request_id, reply_token):
    domain = os.environ["INBOUND_EMAIL_DOMAIN"]
    return f"requests+{request_id}.{reply_token}@{domain}"


def find_request(payload, request_id):
    for item in payload["requests"]:
        if item["request_id"] == request_id:
            return item
    return None


def extract_reply_reference(recipients):
    if isinstance(recipients, str):
        recipients = [recipients]

    for recipient in recipients:
        _, email = parseaddr(recipient)
        match = re.match(r"^requests\+([^.@]+)\.([^@]+)@", email)
        if match:
            return match.group(1), match.group(2)
    return None, None


@app.post("/request")
def create_request():
    body = request.json
    target_email = body["target_email"]
    target_name = body["target_name"]
    requester_name = body["requester_name"]
    requester_slack_channel = body["requester_slack_channel"]
    needed_info = body["needed_info"]
    context = body.get("context", {})

    draft = tc.run_agent(f"""
Draft a short email asking for missing information.

Needed information:
{needed_info}

Target:
{target_name} <{target_email}>

Requester:
{requester_name}

Context:
{json.dumps(context, indent=2)}

Return JSON with subject and body. The body should ask the question directly and mention that the recipient can reply to the email.
""")

    request_id = uuid.uuid4().hex
    reply_token = secrets.token_urlsafe(24)
    reply_to = reply_address(request_id, reply_token)

    record = {
        "request_id": request_id,
        "target_email": target_email.lower(),
        "target_name": target_name,
        "requester_name": requester_name,
        "requester_slack_channel": requester_slack_channel,
        "needed_info": needed_info,
        "context": context,
        "subject": draft["subject"],
        "body": draft["body"],
        "reply_token_hash": token_hash(reply_token),
        "reply_to": reply_to,
        "status": "pending",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "last_reminder_at": None,
        "reminder_count": 0,
        "response_text": None,
    }

    payload = load_pending()
    payload["requests"].append(record)
    save_pending(payload)

    send_email(target_email, draft["subject"], draft["body"], reply_to)
    record_event("request_sent", {"request_id": request_id, "target_email": target_email})
    return {"ok": True, "request_id": request_id, "reply_to": reply_to}


@app.post("/email-inbound")
def email_inbound():
    raw_body = request.get_data()
    verify_hmac_header(raw_body, "X-Inbound-Signature", os.environ["INBOUND_EMAIL_WEBHOOK_SECRET"])

    inbound = request.json
    request_id, reply_token = extract_reply_reference(inbound.get("to", []))
    if not request_id or not reply_token:
        return {"ok": True, "ignored": "not an info-request reply"}

    payload = load_pending()
    item = find_request(payload, request_id)
    if item is None or item["status"] != "pending":
        return {"ok": True, "ignored": "unknown or closed request"}

    _, from_email = parseaddr(inbound["from"])
    if from_email.lower() != item["target_email"]:
        record_event("reply_rejected", {"request_id": request_id, "from": from_email, "reason": "sender mismatch"})
        return {"ok": False, "error": "sender mismatch"}, 403

    if token_hash(reply_token) != item["reply_token_hash"]:
        record_event("reply_rejected", {"request_id": request_id, "from": from_email, "reason": "token mismatch"})
        return {"ok": False, "error": "token mismatch"}, 403

    item["status"] = "answered"
    item["updated_at"] = now_iso()
    item["response_text"] = inbound.get("stripped_text") or inbound.get("text", "")
    save_pending(payload)

    record_event("request_answered", {"request_id": request_id, "from": from_email})
    send_slack_message(
        item["requester_slack_channel"],
        f"{item['target_name']} answered your request for information:\n\n{item['response_text']}",
    )
    return {"ok": True, "request_id": request_id}


@app.post("/internal/remind-pending")
def remind_pending():
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {os.environ['REMINDER_CRON_TOKEN']}":
        return {"ok": False, "error": "unauthorized"}, 401

    payload = load_pending()
    now = datetime.now(timezone.utc)
    reminders_sent = []

    for item in payload["requests"]:
        if item["status"] != "pending" or item["reminder_count"] >= 3:
            continue

        last_touch = item["last_reminder_at"] or item["created_at"]
        last_dt = datetime.fromisoformat(last_touch.replace("Z", "+00:00"))
        if (now - last_dt).total_seconds() < 4 * 3600:
            continue

        body = f"""Hi {item['target_name']},

Following up on this request:

{item['needed_info']}

Original message:
{item['body']}
"""
        send_email(item["target_email"], f"Reminder: {item['subject']}", body, item["reply_to"])
        item["reminder_count"] += 1
        item["last_reminder_at"] = now_iso()
        item["updated_at"] = now_iso()
        reminders_sent.append(item["request_id"])

    save_pending(payload)
    if reminders_sent:
        record_event("reminders_sent", {"request_ids": reminders_sent})
    return {"ok": True, "reminders_sent": reminders_sent}
```

## `workflows/trigger-info-request-reminders/workflow.json`

```json
{
  "name": "Trigger Info Request Reminders",
  "intent_summary": "Calls the info request reminder service to send due reminder emails.",
  "inputs": {},
  "required_secrets": ["INFO_REQUEST_REMINDER_URL", "REMINDER_CRON_TOKEN"],
  "runtime": {"timeout_seconds": 120}
}
```

## `workflows/trigger-info-request-reminders/run.py`

```python
import os
import requests
from teamcopilot import tc

response = requests.post(
    os.environ["INFO_REQUEST_REMINDER_URL"] + "/internal/remind-pending",
    headers={"Authorization": f"Bearer {os.environ['REMINDER_CRON_TOKEN']}"},
    timeout=30,
)
response.raise_for_status()

tc.success(response.json())
```

## Cronjob

```text
name: Info request reminder
target_type: workflow
workflow_slug: trigger-info-request-reminders
workflow_inputs: {}
cron_expression: "0 */4 * * *"
timezone: "UTC"
```

The cronjob does not send emails directly. It starts the workflow, and the workflow calls the hosted service's protected `/internal/remind-pending` endpoint. The service then decides which reminders are due and sends them through the email provider.

## Flow

```text
service receives "ask this person for X"
  -> service drafts the request email
  -> service stores request_id and reply_token_hash
  -> service sends email with Reply-To requests+<request_id>.<reply_token>@...
  -> cronjob runs trigger-info-request-reminders every 4 hours
  -> workflow calls service /internal/remind-pending with REMINDER_CRON_TOKEN
  -> service sends due reminder emails using the same Reply-To address
  -> recipient replies to the email
  -> email provider calls /email-inbound
  -> service verifies provider signature, reply token, and sender email
  -> service marks request answered
  -> service pings requester in Slack with the answer
```

## Why This Is Correlated Correctly

- The request id identifies which pending request the reply belongs to.
- The random reply token prevents someone from guessing a request id and spoofing a reply.
- The inbound provider signature proves the webhook came from the configured email provider.
- The sender email check ensures the answer came from the person who was asked.
- All reminders reuse the same reply address, so late replies still correlate to the same pending request.
