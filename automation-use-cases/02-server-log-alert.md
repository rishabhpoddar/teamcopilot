# Server Log Alert

## Goal

Check production logs periodically and ask the on-call engineer before escalating suspicious errors.

## Primitives

- Cronjob: runs every five minutes.
- Workflow: fetches logs, tracks last offset, classifies errors.
- Workflow data directory: stores last processed log offset.
- `tc.ask_user`: asks on-call whether to alert.

## Resources

```text
workflows/check-prod-logs/
  workflow.json
  run.py

cronjob:
  name: Production log alert
  target_type: workflow
  workflow_slug: check-prod-logs
  workflow_inputs: {"on_call_user_id": "user_oncall"}
  cron_expression: "*/5 * * * *"
  timezone: "UTC"
```

## `check-prod-logs/workflow.json`

```json
{
  "name": "Check Production Logs",
  "intent_summary": "Scan new production logs and ask on-call before escalating suspicious errors.",
  "inputs": {
    "on_call_user_id": {"type": "string", "required": true}
  },
  "required_secrets": ["PROD_LOG_URL", "PROD_LOG_TOKEN", "SLACK_WEBHOOK_URL"],
  "runtime": {"timeout_seconds": 600}
}
```

## `check-prod-logs/run.py`

```python
import argparse, os, requests
from pathlib import Path
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--on_call_user_id", required=True)
args = parser.parse_args()

data_dir = Path("data")
data_dir.mkdir(exist_ok=True)
offset_path = data_dir / "last_offset.txt"
last_offset = int(offset_path.read_text()) if offset_path.exists() else 0

response = requests.get(
    os.environ["PROD_LOG_URL"],
    params={"after": last_offset, "limit": 1000},
    headers={"Authorization": f"Bearer {os.environ['PROD_LOG_TOKEN']}"},
    timeout=20,
)
response.raise_for_status()
new_logs = response.json()

lines = new_logs["lines"]
next_offset = int(new_logs["next_offset"])
offset_path.write_text(str(next_offset))

patterns = ["database timeout", "connection pool exhausted", "deadlock detected"]
matches = [line for line in lines if any(pattern in line.lower() for pattern in patterns)]
if not matches:
    tc.success({"alerted": False, "lines_checked": len(lines), "next_offset": next_offset})

severity = "critical" if len(matches) >= 10 else "warning"

answer = tc.ask_user(
    f"""
    Production logs contain {len(matches)} suspicious errors.

    Severity: {severity}
    Matching lines:
    {chr(10).join(matches[:20])}

    Ask whether to send a Slack incident alert.
    If approved, reply exactly: approve
    If not approved, reply with the reason and recommended next step.
    """,
    user_id=args.on_call_user_id,
)

if answer.strip().lower() == "approve":
    slack = requests.post(
        os.environ["SLACK_WEBHOOK_URL"],
        json={"text": f"{severity.upper()}: {len(matches)} production log errors\n" + "\n".join(matches[:10])},
        timeout=20,
    )
    slack.raise_for_status()

tc.success({
    "alert_decision": answer,
    "severity": severity,
    "matches": matches,
    "next_offset": next_offset,
})
```

## Flow

```text
cronjob fires
  -> workflow reads last_offset from data/last_offset.txt
  -> workflow fetches new logs
  -> workflow updates data/last_offset.txt
  -> suspicious errors found
  -> workflow asks on-call
  -> workflow records decision
```
