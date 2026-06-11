# Multi-Person Refund Approval

## Goal

Evaluate a refund and gather approval from support, finance, and operations when required.

## Primitives

- Workflow: orchestrates approval sequence.
- `tc.ask_user`: asks multiple people in order.

## Resources

```text
workflows/process-refund-request/
  workflow.json
  run.py
```

## `process-refund-request/workflow.json`

```json
{
  "name": "Process Refund Request",
  "inputs": {
    "refund_json": {"type": "string", "required": true},
    "support_lead_user_id": {"type": "string", "required": true},
    "finance_user_id": {"type": "string", "required": true},
    "ops_user_id": {"type": "string", "required": false}
  },
  "required_secrets": ["BILLING_API_URL", "BILLING_API_KEY"],
  "runtime": {"timeout_seconds": 7200}
}
```

## `process-refund-request/run.py`

```python
import argparse, json, os, requests
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--refund_json", required=True)
parser.add_argument("--support_lead_user_id", required=True)
parser.add_argument("--finance_user_id", required=True)
parser.add_argument("--ops_user_id", required=False)
args = parser.parse_args()

refund = json.loads(args.refund_json)
billing = requests.get(
    os.environ["BILLING_API_URL"] + f"/charges/{refund['charge_id']}",
    headers={"Authorization": f"Bearer {os.environ['BILLING_API_KEY']}"},
    timeout=20,
)
billing.raise_for_status()
charge = billing.json()

eligibility = {
    "within_refund_window": charge["days_since_charge"] <= 60,
    "already_refunded": charge["refunded"],
    "amount": refund["amount"],
    "risk": "high" if refund["amount"] > 1000 or charge["dispute_count"] > 0 else "normal",
}

if not eligibility["within_refund_window"] or eligibility["already_refunded"]:
    tc.success({"approved": False, "reason": "not_eligible", "eligibility": eligibility})

support = tc.ask_user(
    f"Ask support lead to approve refund:\n{json.dumps(refund, indent=2)}\nEligibility: {eligibility}",
    user_id=args.support_lead_user_id,
)
if "approve" not in support.lower():
    tc.success({"approved": False, "stopped_at": "support", "reply": support})

finance = tc.ask_user(
    f"Ask finance to approve this refund after support approval:\n{json.dumps(refund, indent=2)}",
    user_id=args.finance_user_id,
)
if "approve" not in finance.lower():
    tc.success({"approved": False, "stopped_at": "finance", "reply": finance})

if refund.get("amount", 0) > 1000 and args.ops_user_id:
    ops = tc.ask_user("Ask operations to approve high-value refund.", user_id=args.ops_user_id)
    if "approve" not in ops.lower():
        tc.success({"approved": False, "stopped_at": "ops", "reply": ops})

tc.success({"approved": True})
```

## Flow

```text
workflow starts
  -> workflow checks eligibility locally
  -> support approval
  -> finance approval
  -> optional operations approval
  -> final decision
```
