# Weekly Churn Risk Review

## Goal

Score accounts for churn risk and ask each account owner to approve outreach.

## Primitives

- Cronjob: weekly schedule.
- Workflow: scores accounts and asks owners.
- `tc.ask_user`: asks account owners.

## Resources

```text
workflows/weekly-churn-risk-review/
  workflow.json
  run.py

cronjob:
  name: Weekly churn risk review
  target_type: workflow
  workflow_slug: weekly-churn-risk-review
  workflow_inputs: {}
  cron_expression: "0 9 * * MON"
```

## `weekly-churn-risk-review/workflow.json`

```json
{
  "name": "Weekly Churn Risk Review",
  "intent_summary": "Score accounts for churn risk and ask account owners before sending outreach.",
  "inputs": {},
  "required_secrets": ["ANALYTICS_API_URL", "ANALYTICS_API_TOKEN"],
  "runtime": {"timeout_seconds": 3600}
}
```

## `weekly-churn-risk-review/run.py`

```python
import os, requests
from teamcopilot import tc

usage_response = requests.get(
    os.environ["ANALYTICS_API_URL"] + "/accounts/usage",
    params={"window_days": 30},
    headers={"Authorization": f"Bearer {os.environ['ANALYTICS_API_TOKEN']}"},
    timeout=30,
)
usage_response.raise_for_status()
accounts = usage_response.json()["accounts"]
decisions = []

for account in accounts:
    usage_drop = account["previous_active_users"] - account["current_active_users"]
    usage_drop_pct = usage_drop / max(account["previous_active_users"], 1)
    risk_score = (
        usage_drop_pct * 0.5
        + min(account["open_support_tickets"], 5) * 0.08
        + (0.25 if account["renewal_days_remaining"] <= 60 else 0)
    )

    account["risk_score"] = round(risk_score, 2)
    if account["risk_score"] < 0.7:
        continue

    suggested_message = f"""
Hi {account['primary_contact_name']},

I noticed usage dipped over the last month and wanted to check whether anything is blocking your team.
Would it be useful to schedule a short working session this week?
"""

    reply = tc.ask_user(
        f"""
        Account {account['name']} has churn risk score {account['risk_score']}.
        Usage drop: {usage_drop_pct:.0%}
        Open support tickets: {account['open_support_tickets']}
        Renewal days remaining: {account['renewal_days_remaining']}

        Ask the account owner whether to send outreach.
        Suggested message:
        {suggested_message}

        Return approve, skip, or edited outreach text.
        """,
        user_id=account["owner_user_id"],
    )

    if reply.strip().lower() == "approve":
        outreach = requests.post(
            os.environ["CRM_API_URL"] + f"/accounts/{account['id']}/outreach",
            headers={"Authorization": f"Bearer {os.environ['CRM_API_TOKEN']}"},
            json={"message": suggested_message},
            timeout=20,
        )
        outreach.raise_for_status()

    decisions.append({
        "account_id": account["id"],
        "risk_score": account["risk_score"],
        "reply": reply,
        "sent": reply.strip().lower() == "approve",
    })

tc.success({"decisions": decisions})
```

## Flow

```text
weekly cronjob
  -> workflow scores accounts
  -> loop asks owners
  -> workflow records decisions
```
