# Incident Triage

## Goal

Receive a monitoring alert, gather context, and ask the on-call engineer before remediation.

This is one hosted service. The monitoring webhook owns the alert lifecycle.

## Primitives

- Hosted service: receives monitoring webhooks.
- `tc.run_agent`: gathers diagnostics and proposes next action.
- `tc.ask_user`: asks on-call before remediation.

## Resources

```text
services/incident-triage/
  service.json
  server.py
```

## `services/incident-triage/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def trigger_remediation(service_name, action):
    response = requests.post(
        os.environ["OPS_API_URL"] + "/remediations",
        headers={"Authorization": f"Bearer {os.environ['OPS_API_TOKEN']}"},
        json={"service": service_name, "action": action},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/alert")
def alert():
    alert = request.json
    diagnostics = tc.run_agent(f"""
    Investigate this production alert and return JSON with summary, risk, likely_cause, and recommended_action.

    Alert:
    {alert}
    """)

    decision = tc.ask_user(
        f"""
        Incident alert:
        {alert}

        Diagnostics:
        {diagnostics}

        Ask the on-call engineer whether to remediate, observe, or escalate.
        """,
        user_id=os.environ["ON_CALL_USER_ID"],
    )

    remediation = None
    if decision.strip().lower() == "remediate":
        remediation = trigger_remediation(alert["service"], diagnostics["recommended_action"])

    return {"ok": True, "decision": decision, "diagnostics": diagnostics, "remediation": remediation}
```

## Flow

```text
monitoring webhook
  -> service runs agent diagnostics
  -> service asks on-call
  -> service triggers remediation if approved
```
