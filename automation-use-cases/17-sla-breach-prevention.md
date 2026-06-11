# SLA Breach Prevention

## Goal

Check tickets near SLA breach and ask the support manager whether to reassign or escalate.

## Primitives

- Cronjob: frequent schedule.
- Workflow: ticket scan and prioritization.
- Workflow data directory: suppresses repeated alerts.
- `tc.ask_user`: asks support manager.

## Resources

```text
workflows/check-sla-risk/
  workflow.json
  run.py

cronjob:
  name: SLA breach prevention
  target_type: workflow
  workflow_slug: check-sla-risk
  workflow_inputs: {"support_manager_user_id": "user_support_manager"}
  cron_expression: "*/15 * * * *"
```

## `check-sla-risk/workflow.json`

```json
{
  "name": "Check SLA Risk",
  "intent_summary": "Find support tickets near SLA breach and ask a manager for routing instructions.",
  "inputs": {
    "support_manager_user_id": {"type": "string", "required": true}
  },
  "required_secrets": ["SUPPORT_API_URL", "SUPPORT_API_TOKEN"],
  "runtime": {"timeout_seconds": 900}
}
```

## `check-sla-risk/run.py`

```python
import argparse, os, requests
from pathlib import Path
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--support_manager_user_id", required=True)
args = parser.parse_args()

data_dir = Path("data")
notified_dir = data_dir / "notified_tickets"
notified_dir.mkdir(parents=True, exist_ok=True)

response = requests.get(
    os.environ["SUPPORT_API_URL"] + "/tickets",
    params={"status": "open", "sla_minutes_remaining_lte": 60},
    headers={"Authorization": f"Bearer {os.environ['SUPPORT_API_TOKEN']}"},
    timeout=20,
)
response.raise_for_status()
tickets = response.json()["tickets"]

new_risks = []
for ticket in tickets:
    key = f"{ticket['id']}-{ticket['sla_deadline']}".replace("/", "_")
    notified_path = notified_dir / f"{key}.txt"
    if notified_path.exists():
        continue
    notified_path.write_text("notified")
    new_risks.append(ticket)

if not new_risks:
    tc.success({"risks": 0})

new_risks.sort(key=lambda ticket: (ticket["sla_minutes_remaining"], -ticket.get("customer_arr_usd", 0)))
summary = [
    {
        "id": ticket["id"],
        "subject": ticket["subject"],
        "minutes_remaining": ticket["sla_minutes_remaining"],
        "owner": ticket.get("assignee_name"),
        "customer_arr_usd": ticket.get("customer_arr_usd", 0),
    }
    for ticket in new_risks[:10]
]

reply = tc.ask_user(
    f"""
    Ask the support manager how to handle these SLA-risk tickets.

    Tickets:
    {summary}

    Ask whether to reassign, page the owner, or escalate to the incident channel.
    Return clear routing instructions.
    """,
    user_id=args.support_manager_user_id,
)

routing = requests.post(
    os.environ["SUPPORT_API_URL"] + "/ticket-routing",
    headers={"Authorization": f"Bearer {os.environ['SUPPORT_API_TOKEN']}"},
    json={"tickets": summary, "instructions": reply},
    timeout=20,
)
routing.raise_for_status()

tc.success({"risks": len(new_risks), "manager_reply": reply, "routing": routing.json()})
```

## Flow

```text
cronjob
  -> workflow scans tickets
  -> workflow data directory suppresses duplicates
  -> manager decides action
```
