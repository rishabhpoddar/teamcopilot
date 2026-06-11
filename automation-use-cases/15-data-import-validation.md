# Data Import Validation

## Goal

Validate uploaded CSV data, ask data operations to resolve ambiguous rows, then import valid rows.

This is one hosted service. The upload endpoint performs validation and import directly.

## Primitives

- Hosted service: receives CSV uploads.
- Service data directory: stores uploaded files.
- `tc.ask_user`: asks data ops to resolve ambiguous rows.

## Resources

```text
services/data-import-upload/
  service.json
  server.py
  data/uploads/
```

## `services/data-import-upload/server.py`

```python
import csv, json, os, re, requests
from pathlib import Path
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)
upload_dir = Path("data/uploads")
upload_dir.mkdir(parents=True, exist_ok=True)

def import_rows(rows):
    response = requests.post(
        os.environ["IMPORT_API_URL"] + "/rows",
        headers={"Authorization": f"Bearer {os.environ['IMPORT_API_TOKEN']}"},
        json={"rows": rows},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()

@app.post("/upload")
def upload():
    file = request.files["csv"]
    saved_path = upload_dir / file.filename
    file.save(saved_path)

    with open(saved_path, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    valid_rows = []
    ambiguous = []
    rejected = []
    for index, row in enumerate(rows, start=2):
        normalized = {key.strip().lower(): value.strip() for key, value in row.items()}
        email = normalized.get("email", "")
        plan = normalized.get("plan", "").lower()
        seats = normalized.get("seats", "0")

        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
            rejected.append({"line": index, "reason": "invalid_email"})
        elif plan not in ["starter", "pro", "enterprise"] or not seats.isdigit():
            ambiguous.append({"line": index, "row": row})
        else:
            valid_rows.append({"email": email, "plan": plan, "seats": int(seats)})

    if ambiguous:
        resolution = tc.ask_user(
            f"""
            Ask data ops to resolve these ambiguous CSV rows:
            {json.dumps(ambiguous[:20], indent=2)}

            Return JSON with corrected_rows and rejected_lines.
            """,
            user_id=os.environ["DATA_OPS_USER_ID"],
        )
        resolved = json.loads(resolution)
        valid_rows.extend(resolved.get("corrected_rows", []))
        rejected.extend({"line": line, "reason": "rejected_by_data_ops"} for line in resolved.get("rejected_lines", []))

    result = import_rows(valid_rows) if valid_rows else {"imported": 0}
    return {"ok": True, "import": result, "valid_rows": len(valid_rows), "rejected": rejected}
```

## Flow

```text
upload
  -> service validates rows
  -> service asks data ops for ambiguous rows
  -> service imports valid rows
```
