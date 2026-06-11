# Release Readiness Checklist

## Goal

Check release readiness and gather approvals from engineering, support, and product.

## Primitives

- Workflow: orchestrates checks and approvals.
- `tc.ask_user`: asks team leads.

## Resources

```text
workflows/release-readiness/
  workflow.json
  run.py
```

## `release-readiness/run.py`

```python
import argparse
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--engineering_lead_user_id", required=True)
parser.add_argument("--support_lead_user_id", required=True)
parser.add_argument("--product_lead_user_id", required=True)
args = parser.parse_args()

tests = tc.run_agent("Check whether the release test suite is healthy. Return JSON with status, failures, and summary.")
incidents = tc.run_agent("Check whether there are open incidents that should block release. Return JSON with blockers and summary.")

summary = {"tests": tests, "incidents": incidents}

eng = tc.ask_user(f"Ask engineering lead to approve release readiness:\n{summary}", user_id=args.engineering_lead_user_id)
support = tc.ask_user(f"Ask support lead to approve release readiness:\n{summary}", user_id=args.support_lead_user_id)
product = tc.ask_user(f"Ask product lead to approve release readiness:\n{summary}", user_id=args.product_lead_user_id)

tc.success({"engineering": eng, "support": support, "product": product})
```

## Flow

```text
release workflow
  -> test check
  -> incident check
  -> engineering approval
  -> support approval
  -> product approval
```
