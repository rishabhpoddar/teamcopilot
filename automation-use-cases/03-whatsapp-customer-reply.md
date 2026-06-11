# WhatsApp Customer Reply

## Goal

Receive inbound WhatsApp messages, draft a reply, ask a support lead when needed, and send the final reply.

This is one hosted service. No workflow is needed because the webhook service owns the event and can call the shared SDK directly.

## Primitives

- Hosted service: receives the WhatsApp webhook and sends replies.
- Service data directory: dedupes message ids.
- `tc.ask_user`: asks the support lead only when approval or replacement text is needed.

## Resources

```text
services/whatsapp-listener/
  service.json
  server.py
  data/seen_messages/
```

## `services/whatsapp-listener/server.py`

```python
import os, requests
from pathlib import Path
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

seen_dir = Path("data/seen_messages")
seen_dir.mkdir(parents=True, exist_ok=True)

def send_whatsapp(to_number, body):
    response = requests.post(
        f"https://graph.facebook.com/v20.0/{os.environ['WHATSAPP_PHONE_NUMBER_ID']}/messages",
        headers={"Authorization": f"Bearer {os.environ['WHATSAPP_API_TOKEN']}"},
        json={
            "messaging_product": "whatsapp",
            "to": to_number,
            "text": {"body": body},
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()

@app.post("/webhook")
def webhook():
    payload = request.json
    value = payload["entry"][0]["changes"][0]["value"]
    message = value["messages"][0]
    contact = value["contacts"][0]

    message_id = message["id"]
    seen_path = seen_dir / f"{message_id}.txt"
    if seen_path.exists():
        return {"ok": True, "duplicate": True}
    seen_path.write_text("seen")

    from_number = message["from"]
    text = message.get("text", {}).get("body", "")

    draft_reply = tc.run_agent(f"""
        Draft a concise WhatsApp support reply.
        Customer name: {contact["profile"]["name"]}
        Message text: {text}

        Set needs_approval=true for refunds, legal commitments, angry customers, outages, or account-specific promises.
        """, schema={
            "type": "object",
            "required": ["reply_text", "needs_approval", "reason"],
            "properties": {
                "reply_text": {"type": "string"},
                "needs_approval": {"type": "boolean"},
                "reason": {"type": "string"},
            },
        })
    draft = draft_reply["data"]

    reply_text = draft["reply_text"]
    if draft["needs_approval"]:
        answer = tc.ask_user(
            f"""
            A WhatsApp customer message needs approval.

            Customer: {contact['profile']['name']} ({from_number})
            Message: {text}
            Draft reply: {reply_text}
            Reason approval is needed: {draft['reason']}

            Return structured data matching the provided schema.
            """,
            user_id=os.environ["SUPPORT_LEAD_USER_ID"],
            schema={
                "type": "object",
                "required": ["decision", "reply_text"],
                "properties": {
                    "decision": {"type": "string", "enum": ["approve", "replace"]},
                    "reply_text": {"type": "string"},
                },
            },
        )
        answer_data = answer["data"]
        reply_text = reply_text if answer_data["decision"] == "approve" else answer_data["reply_text"]

    send_result = send_whatsapp(from_number, reply_text)
    return {"ok": True, "message_id": message_id, "sent": send_result}
```

## Flow

```text
WhatsApp webhook
  -> service dedupes message id
  -> service runs agent draft
  -> service asks support lead only if needed
  -> service sends WhatsApp reply
```
