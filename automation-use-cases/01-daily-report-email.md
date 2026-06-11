# Daily Report Email

## Goal

Every morning, generate an internal business report and ask a manager whether it should be sent.

## Primitives

- Cronjob: schedules the daily run.
- Workflow: generates the report and asks for approval.
- `tc.ask_user`: asks the manager whether to send.
- `tc.success` / `tc.fail`: records terminal result.

## Resources

```text
workflows/generate-daily-report/
  workflow.json
  run.py

cronjob:
  name: Daily report email
  target_type: workflow
  workflow_slug: generate-daily-report
  workflow_inputs: {"manager_user_id": "user_manager"}
  cron_expression: "0 8 * * *"
  timezone: "Asia/Kolkata"
```

## `generate-daily-report/workflow.json`

```json
{
  "name": "Generate Daily Report",
  "intent_summary": "Generate a daily business report and ask a manager before sending it.",
  "inputs": {
    "manager_user_id": {"type": "string", "required": true}
  },
  "required_secrets": ["REPORTING_API_KEY", "REPORTING_API_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "REPORT_FROM_EMAIL"],
  "runtime": {"timeout_seconds": 1800}
}
```

## `generate-daily-report/run.py`

```python
import argparse, os, requests, smtplib
from email.message import EmailMessage
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--manager_user_id", required=True)
args = parser.parse_args()

metrics_response = requests.get(
    os.environ["REPORTING_API_URL"] + "/daily-summary",
    headers={"Authorization": f"Bearer {os.environ['REPORTING_API_KEY']}"},
    timeout=30,
)
metrics_response.raise_for_status()
metrics = metrics_response.json()

report = f"""
Daily business report

Revenue yesterday: ${metrics['revenue_yesterday_usd']:,}
New pipeline: ${metrics['new_pipeline_usd']:,}
Active trials: {metrics['active_trials']}
Open customer risks: {len(metrics['customer_risks'])}

Top wins:
{chr(10).join("- " + win for win in metrics['top_wins'][:5])}

Customer risks:
{chr(10).join("- " + risk['account'] + ": " + risk['reason'] for risk in metrics['customer_risks'][:5])}
""".strip()

answer = tc.ask_user(
    f"""
    Review this daily report and ask whether it should be emailed to leadership.

    Report:
    {report}

    If approved, reply exactly: approve
    If rejected, reply exactly: reject
    If edits are requested, reply with the complete revised report text.
    """,
    user_id=args.manager_user_id,
)

normalized_answer = answer.strip().lower()
if normalized_answer == "reject":
    tc.success({"sent": False, "manager_response": answer, "metrics_date": metrics["date"]})

final_report = report if normalized_answer == "approve" else answer

if final_report.strip():
    email = EmailMessage()
    email["Subject"] = "Daily business report"
    email["From"] = os.environ["REPORT_FROM_EMAIL"]
    email["To"] = ", ".join(metrics["leadership_emails"])
    email.set_content(final_report)

    with smtplib.SMTP_SSL(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])) as smtp:
        smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(email)

    tc.success({"sent": True, "report": final_report, "metrics_date": metrics["date"]})

tc.success({"sent": False, "manager_response": answer})
```

## Flow

```text
cronjob fires
  -> generate-daily-report runs
  -> workflow asks manager
  -> manager approves or edits
  -> workflow sends email directly
  -> report run succeeds or fails
```
