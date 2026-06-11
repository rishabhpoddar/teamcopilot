# OAuth Token Maintenance

## Goal

Handle OAuth callbacks and refresh tokens periodically, asking the owner to reauthorize when needed.

## Primitives

- Hosted service: receives OAuth callback.
- Cronjob: refresh schedule.
- Workflow: refresh logic.
- Shared data directory: stores non-secret account metadata.
- `tc.ask_user`: asks owner to reauthorize.

## Resources

```text
services/oauth-callback/
  service.json
  server.py

workflows/refresh-oauth-token/
  workflow.json
  run.py
```

## `services/oauth-callback/server.py`

```python
import json, os, time
from pathlib import Path
from flask import Flask, request

app = Flask(__name__)

data_dir = Path("data")
data_dir.mkdir(exist_ok=True)
accounts_path = data_dir / "oauth_accounts.json"

def load_accounts():
    return json.loads(accounts_path.read_text()) if accounts_path.exists() else []

def save_accounts(accounts):
    accounts_path.write_text(json.dumps(accounts, indent=2))

@app.get("/callback")
def callback():
    account_id = request.args["state"]
    code = request.args["code"]

    accounts = [account for account in load_accounts() if account["account_id"] != account_id]
    accounts.append({
        "account_id": account_id,
        "provider": "google",
        "connected_at": int(time.time()),
        "authorization_code_ref": code,
        "owner_user_id": request.args.get("owner_user_id", "user_owner"),
    })
    save_accounts(accounts)

    return "OAuth connection saved. You can close this window."
```

## `refresh-oauth-token/run.py`

```python
import argparse, json, os, requests
from pathlib import Path
from teamcopilot import tc

parser = argparse.ArgumentParser()
parser.add_argument("--owner_user_id", required=True)
args = parser.parse_args()

accounts_path = Path("data/oauth_accounts.json")
accounts = json.loads(accounts_path.read_text()) if accounts_path.exists() else []
reauth_needed = []
refreshed = []

for account in accounts:
    response = requests.post(
        os.environ["OAUTH_REFRESH_URL"],
        json={"account_id": account["account_id"], "provider": account["provider"]},
        headers={"Authorization": f"Bearer {os.environ['OAUTH_ADMIN_TOKEN']}"},
        timeout=20,
    )
    if response.status_code == 401:
        reauth_needed.append(account)
        continue
    response.raise_for_status()
    account["last_refreshed_at"] = response.json()["refreshed_at"]
    refreshed.append(account["account_id"])

accounts_path.write_text(json.dumps(accounts, indent=2))

if reauth_needed:
    reply = tc.ask_user(
        f"""
        Ask the owner to reauthorize these OAuth accounts.

        Accounts:
        {json.dumps(reauth_needed, indent=2)}

        Include the reconnect URL from the provider dashboard and ask them to confirm after reconnecting.
        """,
        user_id=args.owner_user_id,
        schema={
            "type": "object",
            "required": ["notified", "confirmation"],
            "properties": {
                "notified": {"type": "boolean"},
                "confirmation": {"type": "string"},
            },
        },
    )
    tc.success({"reauth_requested": True, "reply": reply["data"], "refreshed": refreshed})

tc.success({"reauth_requested": False, "refreshed": refreshed})
```

## Flow

```text
OAuth callback stores account metadata
  -> cronjob runs refresh workflow
  -> workflow refreshes tokens
  -> workflow asks owner if reauth is needed
```
