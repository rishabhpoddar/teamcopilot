# Production Change Gatekeeper

## Goal

Receive deploy requests and require on-call plus release manager approval before proceeding.

This is one hosted service. It receives the deploy request, evaluates risk, asks approvers, and triggers deployment.

## Primitives

- Hosted service: receives deploy requests.
- `tc.run_agent`: evaluates deploy risk from request context.
- `tc.ask_user`: asks on-call and release manager.

## Resources

```text
services/deploy-gate/
  service.json
  server.py
```

## `services/deploy-gate/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def trigger_deploy(payload):
    response = requests.post(
        os.environ["DEPLOY_API_URL"] + "/deployments",
        headers={"Authorization": f"Bearer {os.environ['DEPLOY_API_TOKEN']}"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()

@app.post("/deploy-request")
def deploy_request():
    payload = request.json
    risk = tc.run_agent(f"""
        Evaluate this production deploy request.

        Request:
        {payload}

        Consider tests, open incidents, migration risk, touched services, and rollback plan.
        """, schema={
            "type": "object",
            "required": ["risk_level", "summary", "blocking_concerns", "approval_recommendation"],
            "properties": {
                "risk_level": {"type": "string"},
                "summary": {"type": "string"},
                "blocking_concerns": {"type": "array"},
                "approval_recommendation": {"type": "string"},
            },
        })["data"]

    approval_schema = {
        "type": "object",
        "required": ["decision", "reason"],
        "properties": {
            "decision": {"type": "string", "enum": ["approve", "reject"]},
            "reason": {"type": "string"},
        },
    }

    on_call = tc.ask_user(
        f"Ask on-call to approve this deploy:\nRequest: {payload}\nRisk: {risk}",
        user_id=os.environ["ON_CALL_USER_ID"],
        schema=approval_schema,
    )
    on_call_data = on_call["data"]
    if on_call_data["decision"] != "approve":
        return {"ok": True, "deployed": False, "stopped_at": "on_call", "reply": on_call_data, "risk": risk}

    manager = tc.ask_user(
        f"Ask release manager to approve this deploy:\nRequest: {payload}\nRisk: {risk}",
        user_id=os.environ["RELEASE_MANAGER_USER_ID"],
        schema=approval_schema,
    )
    manager_data = manager["data"]
    if manager_data["decision"] != "approve":
        return {"ok": True, "deployed": False, "stopped_at": "release_manager", "reply": manager_data, "risk": risk}

    deployment = trigger_deploy(payload)
    return {"ok": True, "deployed": True, "risk": risk, "deployment": deployment}
```

## Flow

```text
deploy request
  -> service runs agent risk check
  -> service asks on-call
  -> service asks release manager
  -> service triggers deployment if both approve
```
