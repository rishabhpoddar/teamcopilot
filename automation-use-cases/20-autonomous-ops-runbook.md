# Autonomous Ops Runbook

## Goal

Run an incident runbook that gathers diagnostics, asks before destructive action, and records a final summary.

This is one hosted service. The service receives the alert and runs the runbook inline.

## Primitives

- Hosted service: receives monitoring webhooks.
- `tc.run_agent`: gathers diagnostics and proposes runbook steps.
- `tc.ask_user`: asks on-call before destructive action.

## Resources

```text
services/ops-runbook/
  service.json
  server.py
```

## `services/ops-runbook/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def restart_service(service_name):
    response = requests.post(
        os.environ["OPS_API_URL"] + f"/services/{service_name}/restart",
        headers={"Authorization": f"Bearer {os.environ['OPS_API_TOKEN']}"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()

@app.post("/alert")
def alert():
    alert = request.json
    diagnostics = tc.run_agent(f"""
        Run an incident diagnostic pass.

        Alert:
        {alert}

        Return JSON with summary, likely_cause, safe_actions, destructive_actions, and recommendation.
        """)

    decision = tc.ask_user(
        f"""
        Incident runbook diagnostics:
        Alert: {alert}
        Diagnostics: {diagnostics}

        Ask on-call whether to restart service {alert['service']}, observe, or escalate.
        """,
        user_id=os.environ["ON_CALL_USER_ID"],
    )

    actions = []
    if decision.strip().lower() == "restart":
        actions.append({"restart": restart_service(alert["service"])})

    return {"ok": True, "alert": alert, "diagnostics": diagnostics, "decision": decision, "actions": actions}
```

## Flow

```text
ops alert webhook
  -> service runs agent diagnostics
  -> service asks before destructive action
  -> service optionally restarts service
  -> service returns final incident summary
```
