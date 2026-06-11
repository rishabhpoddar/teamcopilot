# Complex Procurement Approval

## Goal

Route purchase requests through budget, security, legal, and department approvals.

## Primitives

- Workflow: approval orchestration.
- `tc.ask_user`: asks multiple approvers.

## Resources

```text
workflows/procurement-approval/
  workflow.json
  run.py
```

## `procurement-approval/run.py`

```python
import argparse, json
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--request_json", required=True)
parser.add_argument("--finance_user_id", required=True)
parser.add_argument("--security_user_id", required=True)
parser.add_argument("--legal_user_id", required=True)
parser.add_argument("--department_owner_user_id", required=True)
args = parser.parse_args()

request = json.loads(args.request_json)
checks = tc.run_agent(f"""
    Evaluate this procurement request.

    Request:
    {json.dumps(request, indent=2)}

    Return JSON with budget, security, legal, and overall_risk sections.
    Include concrete blockers and recommended approval conditions.
    """)

finance_reply = tc.ask_user(f"Finance approval requested:\n{request}\nBudget: {checks['budget']}", user_id=args.finance_user_id)
security_reply = tc.ask_user(f"Security approval requested:\n{request}\nSecurity: {checks['security']}", user_id=args.security_user_id)
legal_reply = tc.ask_user(f"Legal approval requested:\n{request}\nContract risk: {checks['legal']}", user_id=args.legal_user_id)
owner_reply = tc.ask_user(f"Department owner approval requested:\n{request}", user_id=args.department_owner_user_id)

tc.success({
    "finance": finance_reply,
    "security": security_reply,
    "legal": legal_reply,
    "department_owner": owner_reply,
    "checks": checks
})
```

## Flow

```text
procurement workflow
  -> budget check
  -> security check
  -> legal check
  -> finance approval
  -> security approval
  -> legal approval
  -> department owner approval
```
