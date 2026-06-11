# Security Alert Investigation

## Goal

Investigate security alerts and ask the security lead before taking disruptive action.

This is one hosted service. The alert webhook, investigation, user approval, and account action stay together.

## Primitives

- Hosted service: receives security alert webhooks.
- `tc.run_agent`: reviews alert context and recommends action.
- `tc.ask_user`: asks security lead before disabling access.

## Resources

```text
services/security-alerts/
  service.json
  server.py
```

## `services/security-alerts/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def disable_user(user_id):
    response = requests.post(
        os.environ["IDENTITY_API_URL"] + f"/users/{user_id}/disable",
        headers={"Authorization": f"Bearer {os.environ['IDENTITY_API_TOKEN']}"},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/alert")
def alert():
    alert = request.json
    investigation = tc.run_agent(f"""
        Investigate this security alert using the supplied context.

        Alert:
        {alert}
        """, schema={
            "type": "object",
            "required": ["summary", "risk_level", "recommended_action", "evidence"],
            "properties": {
                "summary": {"type": "string"},
                "risk_level": {"type": "string"},
                "recommended_action": {"type": "string", "enum": ["disable_user", "monitor", "dismiss", "escalate"]},
                "evidence": {"type": "array"},
            },
        })["data"]

    decision = tc.ask_user(
        f"""
        Security alert investigation:
        Alert: {alert}
        Investigation: {investigation}

        Ask whether to disable the user, monitor, dismiss, or escalate.
        """,
        user_id=os.environ["SECURITY_LEAD_USER_ID"],
        schema={
            "type": "object",
            "required": ["decision", "reason"],
            "properties": {
                "decision": {"type": "string", "enum": ["disable_user", "monitor", "dismiss", "escalate"]},
                "reason": {"type": "string"},
            },
        },
    )
    decision_data = decision["data"]

    action_result = None
    if decision_data["decision"] == "disable_user":
        action_result = disable_user(alert["user_id"])

    return {"ok": True, "decision": decision_data, "investigation": investigation, "action_result": action_result}
```

## Flow

```text
security alert webhook
  -> service runs agent investigation
  -> service asks security lead
  -> service disables user only if approved
```
