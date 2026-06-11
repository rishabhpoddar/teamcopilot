# Customer Escalation Router

## Goal

Route support messages to the correct owner and ask for escalation approval when risk is high.

This is one hosted service. The queue event starts in the service, so classification, account lookup, approval, and ticket creation stay there.

## Primitives

- Hosted service: receives support queue events.
- `tc.ask_user`: asks the support manager before escalation.

## Resources

```text
services/support-escalation-router/
  service.json
  server.py
```

## `services/support-escalation-router/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def load_account(account_id):
    response = requests.get(
        os.environ["CRM_API_URL"] + f"/accounts/{account_id}",
        headers={"Authorization": f"Bearer {os.environ['CRM_API_TOKEN']}"},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

def create_escalation(message, urgency, reasons, instructions):
    response = requests.post(
        os.environ["SUPPORT_API_URL"] + "/escalations",
        headers={"Authorization": f"Bearer {os.environ['SUPPORT_API_TOKEN']}"},
        json={"message": message, "urgency": urgency, "reasons": reasons, "instructions": instructions},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/queue-event")
def queue_event():
    message = request.json
    account = load_account(message["account_id"])
    body = f"{message.get('subject', '')}\n{message.get('body', '')}".lower()

    score = 0
    reasons = []
    if any(term in body for term in ["down", "outage", "security", "breach", "cannot login"]):
        score += 4
        reasons.append("critical keyword")
    if account.get("arr_usd", 0) >= 50000:
        score += 3
        reasons.append("strategic account")
    if message.get("hours_waiting", 0) >= 12:
        score += 2
        reasons.append("long wait")

    urgency = "critical" if score >= 6 else "high" if score >= 3 else "normal"
    if urgency == "normal":
        return {"ok": True, "urgency": urgency, "escalated": False, "reasons": reasons}

    decision = tc.ask_user(
        f"""
        Ask the support manager whether to escalate this customer message.

        Urgency: {urgency}
        Reasons: {reasons}
        Message: {message}
        Account: {account}

        Return structured data matching the provided schema.
        """,
        user_id=os.environ["SUPPORT_MANAGER_USER_ID"],
        schema={
            "type": "object",
            "required": ["decision", "instructions"],
            "properties": {
                "decision": {"type": "string", "enum": ["escalate", "keep_in_queue"]},
                "instructions": {"type": "string"},
            },
        },
    )
    decision_data = decision["data"]

    escalated = decision_data["decision"] == "escalate"
    ticket = create_escalation(message, urgency, reasons, decision_data["instructions"]) if escalated else None
    return {"ok": True, "urgency": urgency, "reasons": reasons, "decision": decision_data, "ticket": ticket}
```

## Flow

```text
queue event
  -> service loads account context
  -> service scores urgency
  -> service asks manager if high risk
  -> service creates escalation if approved
```
