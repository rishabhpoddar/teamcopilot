# Vendor Invoice Processing

## Goal

Process uploaded invoices, ask accounting to fix uncertain fields, ask a manager for approval, and create a payment draft.

This is one hosted service. Upload handling and payment API calls stay in the service.

## Primitives

- Hosted service: receives invoice uploads.
- Service data directory: stores uploaded files.
- `tc.run_agent`: extracts invoice fields from text.
- `tc.ask_user`: asks accounting and manager.

## Resources

```text
services/invoice-upload/
  service.json
  server.py
  data/uploads/
```

## `services/invoice-upload/server.py`

```python
import json, os, requests
from pathlib import Path
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)
upload_dir = Path("data/uploads")
upload_dir.mkdir(parents=True, exist_ok=True)

def create_payment(invoice):
    response = requests.post(
        os.environ["PAYMENTS_API_URL"] + "/payment-drafts",
        headers={"Authorization": f"Bearer {os.environ['PAYMENTS_API_KEY']}"},
        json=invoice,
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/upload")
def upload():
    file = request.files["invoice"]
    saved_path = upload_dir / file.filename
    file.save(saved_path)
    text = saved_path.read_text(encoding="utf-8", errors="ignore")

    invoice = tc.run_agent(f"""
        Extract invoice fields.

        Filename: {file.filename}
        Text:
        {text[:30000]}

        Return JSON with vendor, invoice_number, due_date, currency, amount, confidence, and issues.
        """)

    if invoice["confidence"] < 0.9 or invoice["issues"]:
        correction = tc.ask_user(
            f"""
            Ask accounting to verify this invoice extraction.

            Extracted invoice:
            {json.dumps(invoice, indent=2)}

            Return corrected JSON with vendor, invoice_number, due_date, currency, and amount.
            """,
            user_id=os.environ["ACCOUNTING_USER_ID"],
        )
        invoice.update(json.loads(correction))

    approval = tc.ask_user(
        f"Ask the manager to approve this invoice for payment:\n{json.dumps(invoice, indent=2)}",
        user_id=os.environ["MANAGER_USER_ID"],
    )

    payment = None
    if approval.strip().lower() == "approve":
        payment = create_payment(invoice)

    return {"ok": True, "approved": approval.strip().lower() == "approve", "invoice": invoice, "payment": payment}
```

## Flow

```text
upload
  -> service saves file
  -> service runs agent extraction
  -> service asks accounting if uncertain
  -> service asks manager
  -> service creates payment draft if approved
```
