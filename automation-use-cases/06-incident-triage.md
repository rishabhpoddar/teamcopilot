# Incident Triage

## Goal

Receive a monitoring alert, gather context, and ask multiple responders before remediation.

This is one hosted service. The monitoring webhook owns the alert lifecycle.

## Primitives

- Hosted service: receives monitoring webhooks.
- `tc.run_agent`: gathers diagnostics and proposes next action.
- `tc.ask_user`: asks multiple responders before remediation.

## Resources

```text
services/incident-triage/
  service.json
  server.py
```

## `services/incident-triage/server.py`

```python
import os, requests
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    diagnostics_reply = tc.run_agent(f"""
    Investigate this production alert.

    Alert:
    {alert}
    """, schema={
        "type": "object",
        "required": ["summary", "risk", "likely_cause", "recommended_action"],
        "properties": {
            "summary": {"type": "string"},
            "risk": {"type": "string"},
            "likely_cause": {"type": "string"},
            "recommended_action": {"type": "string"},
        },
    })
    diagnostics = diagnostics_reply["data"]

    remediation = None
    responders = [
        os.environ["ON_CALL_USER_ID"],
        os.environ["SRE_MANAGER_USER_ID"],
        os.environ["SECURITY_LEAD_USER_ID"],
    ]

    prompt = f"""
    Incident alert:
    {alert}

    Diagnostics:
    {diagnostics}

    Ask whether this user wants to remediate, observe, or escalate.
    If they say remediate, that is enough to trigger remediation.
    """

    decisions = []
    with ThreadPoolExecutor(max_workers=len(responders)) as executor:
        future_to_user = {
            executor.submit(
                tc.ask_user,
                prompt,
                user_id=user_id,
                schema={
                    "type": "object",
                    "required": ["decision", "reason"],
                    "properties": {
                        "decision": {"type": "string", "enum": ["remediate", "observe", "escalate"]},
                        "reason": {"type": "string"},
                    },
                },
            ): user_id
            for user_id in responders
        }

        for future in as_completed(future_to_user):
            user_id = future_to_user[future]
            decision = future.result()["data"]
            decisions.append({"user_id": user_id, "decision": decision})
            if remediation is None and decision["decision"] == "remediate":
                remediation = trigger_remediation(alert["service"], diagnostics["recommended_action"])

    last_decision = decisions[-1]["decision"] if decisions else {"decision": "observe", "reason": "no response"}

    return {
        "ok": True,
        "decisions": decisions,
        "diagnostics": diagnostics,
        "last_decision": last_decision,
        "remediation": remediation,
    }
```

## Flow

```text
monitoring webhook
  -> service runs agent diagnostics
  -> service asks on-call, SRE manager, and security lead in parallel
  -> first user to say remediate triggers remediation
```
