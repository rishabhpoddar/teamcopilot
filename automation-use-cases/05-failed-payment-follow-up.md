# Failed Payment Follow-Up

## Goal

Handle Stripe payment failure events and coordinate follow-up for high-value customers.

This is one hosted service. It does not need a workflow because the Stripe webhook service can load customer context, ask users, and send the follow-up directly.

## Primitives

- Hosted service: receives Stripe webhook.
- `tc.ask_user`: asks the account owner and finance lead when the customer is high value.

## Resources

```text
services/stripe-payment-failures/
  service.json
  server.py
```

## `services/stripe-payment-failures/server.py`

```python
import os, requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

def load_customer(customer_id):
    response = requests.get(
        os.environ["BILLING_API_URL"] + f"/customers/{customer_id}",
        headers={"Authorization": f"Bearer {os.environ['BILLING_API_KEY']}"},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

def send_email(customer_id, subject, body):
    response = requests.post(
        os.environ["EMAIL_API_URL"] + "/send",
        headers={"Authorization": f"Bearer {os.environ['EMAIL_API_KEY']}"},
        json={"customer_id": customer_id, "subject": subject, "body": body},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/webhook")
def webhook():
    event = request.json
    if event["type"] != "invoice.payment_failed":
        return {"ok": True, "ignored": event["type"]}

    invoice = event["data"]["object"]
    customer = load_customer(invoice["customer"])
    amount = invoice["amount_due"] / 100
    currency = invoice["currency"].upper()

    if customer["arr_usd"] < 25000 and amount < 5000:
        return {"ok": True, "action": "let_stripe_dunning_handle_it"}

    draft = f"""
Hi {customer['billing_contact_name']},

We were unable to process the {currency} {amount:,.2f} payment for {customer['name']}.
Could you confirm whether we should retry the same payment method, or should we send an updated payment link?

We can keep service active until {customer['grace_period_ends_at']} while this is resolved.
"""

    owner_reply = tc.ask_user(
        f"""
        A high-value customer's payment failed.

        Customer: {customer['name']}
        ARR: ${customer['arr_usd']:,}
        Draft follow-up:
        {draft}

        Ask the account owner to approve or edit this message.
        Return structured data matching the provided schema.
        """,
        user_id=customer["account_owner_user_id"],
        schema={
            "type": "object",
            "required": ["decision", "message"],
            "properties": {
                "decision": {"type": "string", "enum": ["approve", "edit"]},
                "message": {"type": "string"},
            },
        },
    )
    owner_data = owner_reply["data"]
    final_message = draft if owner_data["decision"] == "approve" else owner_data["message"]

    finance_reply = tc.ask_user(
        f"""
        Ask finance to approve sending this payment follow-up.

        Customer: {customer['name']}
        Failed amount: {currency} {amount:,.2f}
        Message:
        {final_message}

        Return structured data matching the provided schema.
        """,
        user_id=os.environ["FINANCE_USER_ID"],
        schema={
            "type": "object",
            "required": ["decision", "reason"],
            "properties": {
                "decision": {"type": "string", "enum": ["approve", "hold", "needs_changes"]},
                "reason": {"type": "string"},
            },
        },
    )
    finance_data = finance_reply["data"]

    sent = False
    if finance_data["decision"] == "approve":
        send_email(invoice["customer"], f"Payment issue for {customer['name']}", final_message)
        sent = True

    return {
        "ok": True,
        "customer_id": invoice["customer"],
        "sent": sent,
        "account_owner_decision": owner_data,
        "finance_decision": finance_data,
    }
```

## Flow

```text
Stripe webhook
  -> service loads customer context
  -> service ignores low-value failures
  -> service asks account owner
  -> service asks finance
  -> service sends email if approved
```
