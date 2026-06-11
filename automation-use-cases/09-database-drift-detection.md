# Database Drift Detection

## Goal

Check database schema drift and ask the database owner before creating an issue.

## Primitives

- Cronjob: scheduled drift check.
- Workflow: introspects and compares schema.
- Workflow data directory: suppresses duplicate drift alerts.
- `tc.ask_user`: asks owner.

## Resources

```text
workflows/check-database-drift/
  workflow.json
  run.py

cronjob:
  name: Database drift check
  target_type: workflow
  workflow_slug: check-database-drift
  workflow_inputs: {"database_owner_user_id": "user_dba"}
  cron_expression: "0 * * * *"
```

## `check-database-drift/workflow.json`

```json
{
  "name": "Check Database Drift",
  "intent_summary": "Compare live PostgreSQL schema against the expected schema and ask before creating an issue.",
  "inputs": {
    "database_owner_user_id": {"type": "string", "required": true}
  },
  "required_secrets": ["DATABASE_URL"],
  "runtime": {"timeout_seconds": 900}
}
```

## `check-database-drift/run.py`

```python
import argparse, hashlib, json, os, subprocess
from pathlib import Path
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--database_owner_user_id", required=True)
args = parser.parse_args()

expected_path = Path("schema/expected-schema.json")
expected = json.loads(expected_path.read_text())

dump = subprocess.run(
    ["pg_dump", "--schema-only", "--no-owner", "--no-privileges", os.environ["DATABASE_URL"]],
    check=True,
    capture_output=True,
    text=True,
)

actual_objects = []
for line in dump.stdout.splitlines():
    stripped = line.strip()
    if stripped.startswith("CREATE TABLE") or stripped.startswith("ALTER TABLE"):
        actual_objects.append(stripped)

actual = {"schema_lines": actual_objects}
expected_lines = set(expected["schema_lines"])
actual_lines = set(actual["schema_lines"])
added = sorted(actual_lines - expected_lines)
removed = sorted(expected_lines - actual_lines)
diff = json.dumps({"added": added, "removed": removed}, indent=2)

if not added and not removed:
    tc.success({"drift": False})

drift_hash = hashlib.sha256(diff.encode()).hexdigest()
data_dir = Path("data")
data_dir.mkdir(exist_ok=True)
hash_path = data_dir / "last_drift_hash.txt"

if hash_path.exists() and hash_path.read_text() == drift_hash:
    tc.success({"drift": True, "duplicate": True})

hash_path.write_text(drift_hash)
decision = tc.ask_user(
    f"Database drift detected:\n{diff}\nAsk whether to create an issue.",
    user_id=args.database_owner_user_id,
)

tc.success({"drift": True, "decision": decision})
```

## Flow

```text
cronjob
  -> drift workflow
  -> diff schema
  -> suppress duplicate using data/last_drift_hash.txt
  -> ask owner
```
