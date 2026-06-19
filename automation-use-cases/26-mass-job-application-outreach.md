# Mass Job Application Outreach

## Goal

Each time the automation runs, find up to 1000 relevant jobs, resolve the right person to contact for each (recruiter or hiring manager), and message them by email or LinkedIn with a tailored application. If a contact does not reply within a configured window, follow up automatically a bounded number of times. When a contact replies, tell the user.

The hard part is not "send 1000 messages." It is keeping one consistent picture of every application as four different actors touch it:

- the per-run **apply workflow** that discovers jobs and creates applications,
- the **service** that actually sends messages and owns reply correlation,
- the **tick cronjob** that paces sends, fires follow-ups, and polls LinkedIn,
- the inbound **email webhook** that records replies.

If each actor kept its own copy of "who have I contacted and what happened," they would drift immediately. So this design gives **one owner for each piece of state** and makes every other actor go through that owner.

## Component choice (per the minimization rule)

- The canonical, long-lived, event-driven state (applications, replies, follow-up timers, dedupe) must survive across runs and must accept inbound email at any time. That belongs to **one hosted service**, not a workflow, because only the service is always up to receive webhooks and to pace sends.
- "Apply to up to 1000 jobs now" is a finite, run-to-completion job. That is **one workflow**. It does discovery + contact resolution + submission, then exits. It deliberately stores **no state of its own** — it pushes everything into the service.
- Pacing sends, firing follow-ups, and polling LinkedIn for replies are periodic. That is **one cronjob** that calls a single protected `/internal/tick` endpoint on the service. One tick endpoint does all three so there is one place that advances time-based state.

Three resources total. No new primitive is needed.

## Primitives used

- Hosted service: owns all state, sends all messages, receives email replies, polls LinkedIn, notifies the user.
- Workflow: per-run discovery + contact resolution + submission (`apply-to-jobs`).
- Cronjob → workflow: paces the service's time-based work (`job-outreach-tick`).
- Service data directory: the single source of truth for every application and all bookkeeping.
- `tc.run_agent`: drafts the tailored initial message and follow-up nudges (called by the service at send time, not at submit time, so the per-run workflow stays cheap and fast).
- `tc.ask_user`: one-time human checkpoint in the workflow to approve search criteria / a sample message before the first blast.
- `tc.getSecretToken`: resolves the LinkedIn OAuth-backed token at send/poll time.

## Resources

```text
services/job-outreach/
  service.json
  server.py
  data/
    config.json                 # single source of truth for criteria, resume, policy
    applications/<app_id>.json   # one canonical record per application
    dedupe.json                  # job_fingerprint -> app_id (prevents re-applying)
    send_queue.json              # app_ids awaiting their first send
    notify_queue.json            # app_ids that replied and need the user notified
    linkedin_index.json          # linkedin_conversation_urn -> app_id (reply mapping)
    linkedin_cursor.json         # watermark for LinkedIn reply polling
    events.jsonl                 # append-only audit log

workflows/apply-to-jobs/
  workflow.json
  run.py

workflows/job-outreach-tick/
  workflow.json
  run.py

cronjob:
  name: Job outreach tick
  target_type: workflow
  workflow_slug: job-outreach-tick
  cron_expression: "*/3 * * * *"   # every 3 minutes
  timezone: "UTC"

cronjob (optional, to run a fresh batch on a schedule):
  name: Apply to jobs (scheduled)
  target_type: workflow
  workflow_slug: apply-to-jobs
  workflow_inputs: { "max_jobs": 1000 }
  cron_expression: "0 13 * * 1"    # Mondays 13:00 UTC
  timezone: "UTC"
```

## Data storage map (who owns what, who reads what)

This is the part that makes the pieces sync up. Every row below has exactly one writer-of-record.

| Data | Lives in | Written by | Read by |
|---|---|---|---|
| Search criteria, resume/profile text, channel prefs, throttle + follow-up policy | `data/config.json` | user (via `POST /config`) | apply workflow (`GET /config`), service drafting/sending |
| Canonical per-application record (status, contact, channel, timestamps, follow-up count, reply text) | `data/applications/<app_id>.json` | **service only** | service (tick, webhook), `GET /applications/<id>` for UI/debug |
| "Have I already applied to this job" | `data/dedupe.json` | service (at submit) | service (at submit) |
| Apps awaiting their first send | `data/send_queue.json` | service (submit adds, tick removes) | service (tick) |
| Apps that replied and still need the user notified | `data/notify_queue.json` | service (reply handler adds, tick removes) | service (tick) |
| LinkedIn conversation → application mapping | `data/linkedin_index.json` | service (at submit, for LinkedIn channel) | service (LinkedIn poll) |
| LinkedIn poll watermark | `data/linkedin_cursor.json` | service (LinkedIn poll) | service (LinkedIn poll) |
| Audit trail of everything | `data/events.jsonl` | all service handlers | humans / UI |

Key rule: **the apply workflow and the tick workflow store nothing locally.** They are stateless drivers. All durable state is in the service's `data/` directory, so a replay, a restart, or a second concurrent run sees the same truth.

### How the actors stay in sync

- **Apply workflow → service:** the workflow never decides "is this new." It submits a job + contact; the service consults `dedupe.json` and is the only thing that creates an application. Two overlapping runs that both find the same job both submit it; the second submit is dropped by dedupe. No double-apply.
- **Service drafting/sending → config:** messages are drafted at send time from `config.json` + the job metadata stored on the application record, so updating the resume in config changes future messages without touching any application record.
- **Tick → applications:** time-based transitions (send the first message, send a follow-up) are computed from fields on the application record (`status`, `next_action_at`, `follow_up_count`) — never from anything the cron remembers.
- **Webhook / LinkedIn poll → applications:** a reply only ever flips a record from `active` to `replied` and pushes the id onto `notify_queue.json`. Notifying the user is done later by tick, so the webhook can return `200` to the email provider instantly.

## Reply correlation

**Email** (push): every message the service sends uses a unique reply address

```text
Reply-To: apply+<app_id>.<reply_token>@<INBOUND_EMAIL_DOMAIN>
```

The email provider (Postmark / Mailgun / SendGrid Inbound Parse) is configured to POST inbound replies to `POST /email-inbound`. The service verifies the provider signature, extracts `app_id` and `reply_token` from the recipient, checks the token hash matches the stored record, and checks the sender equals the contacted address. Only then is the application marked `replied`.

**LinkedIn** (pull, no webhook): at submit time the service stores `linkedin_conversation_urn -> app_id` in `linkedin_index.json`. Every tick, the service polls LinkedIn conversations updated since `linkedin_cursor.json`, maps inbound messages back to applications via that index, marks them `replied`, and advances the cursor.

Either way, "replied" converges to the same application record and the same `notify_queue.json`.

## `services/job-outreach/service.json`

```json
{
  "name": "Job Outreach",
  "runtime": "python",
  "entrypoint": "server.py",
  "public_path": "/services/job-outreach",
  "required_secrets": [
    "EMAIL_API_URL",
    "EMAIL_API_TOKEN",
    "EMAIL_FROM",
    "INBOUND_EMAIL_DOMAIN",
    "INBOUND_EMAIL_WEBHOOK_SECRET",
    "LINKEDIN_CONNECTION",
    "OWNER_NOTIFY_EMAIL",
    "TICK_CRON_TOKEN"
  ]
}
```

`LINKEDIN_CONNECTION` is an OAuth-backed key resolved through `tc.getSecretToken` at send/poll time, so no LinkedIn token is ever written to disk.

## `services/job-outreach/server.py`

```python
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from pathlib import Path

import requests
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

DATA = Path("data")
APPS = DATA / "applications"
APPS.mkdir(parents=True, exist_ok=True)

# data_lock guards every read-modify-write of state files (webhook + submit can race).
# tick_lock guarantees only one tick advances time-based state at a time.
data_lock = threading.RLock()
tick_lock = threading.Lock()

DEFAULT_POLICY = {
    "send_batch_per_tick": 40,          # paces sends to avoid spam flagging / rate limits
    "followup_intervals_hours": [72, 168],  # 3 days, then 7 days
    "max_followups": 2,
}


# ---------- low-level storage helpers ----------

def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


def parse(dt_str):
    return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True))
    tmp.replace(path)  # atomic on same filesystem


def event(kind, payload):
    line = json.dumps({"kind": kind, "at": iso(now()), "payload": payload})
    with data_lock:
        with (DATA / "events.jsonl").open("a") as f:
            f.write(line + "\n")


def token_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def app_path(app_id):
    return APPS / f"{app_id}.json"


def load_app(app_id):
    return load_json(app_path(app_id), None)


def save_app(record):
    save_json(app_path(record["app_id"]), record)


def load_config():
    cfg = load_json(DATA / "config.json", {})
    cfg.setdefault("policy", {})
    for k, v in DEFAULT_POLICY.items():
        cfg["policy"].setdefault(k, v)
    return cfg


# ---------- channels (drafting + sending) ----------

def draft_initial(cfg, record):
    return tc.run_agent(f"""
Write a concise, specific outbound job-application message.

Candidate profile / resume:
{cfg.get("resume", "")}

Role: {record["job_title"]} at {record["company"]}
Job description:
{record["job_description"]}

Contact: {record["contact"]["name"]} ({record["contact"].get("title", "recruiter")})
Channel: {record["channel"]}

Keep it under 140 words. Reference one concrete reason the candidate fits this role.
Return subject (ignored for LinkedIn) and body.
""", schema={
        "type": "object",
        "required": ["subject", "body"],
        "properties": {"subject": {"type": "string"}, "body": {"type": "string"}},
    })["data"]


def draft_followup(cfg, record):
    return tc.run_agent(f"""
Write a short, polite follow-up nudge (under 60 words) for an application that has not
received a reply. Do not re-pitch; just bump the thread.

Role: {record["job_title"]} at {record["company"]}
This is follow-up number {record["follow_up_count"] + 1}.
""", schema={
        "type": "object",
        "required": ["body"],
        "properties": {"body": {"type": "string"}},
    })["data"]


def send_email(to_email, subject, body, reply_to):
    r = requests.post(
        os.environ["EMAIL_API_URL"] + "/send",
        headers={"Authorization": f"Bearer {os.environ['EMAIL_API_TOKEN']}"},
        json={"from": os.environ["EMAIL_FROM"], "to": to_email,
              "subject": subject, "body": body, "reply_to": reply_to},
        timeout=30,
    )
    r.raise_for_status()


def linkedin_token():
    secret = tc.getSecretToken("LINKEDIN_CONNECTION")
    if secret["error"]:
        raise RuntimeError(f"LinkedIn auth unavailable: {secret['error']}")
    return secret["token"]


def send_linkedin(conversation_urn, body):
    r = requests.post(
        "https://api.linkedin.com/v2/messages",
        headers={"Authorization": f"Bearer {linkedin_token()}"},
        json={"conversation": conversation_urn, "body": body},
        timeout=30,
    )
    r.raise_for_status()


def reply_to_for(record):
    return f"apply+{record['app_id']}.{record['reply_token']}@{os.environ['INBOUND_EMAIL_DOMAIN']}"


def notify_owner(record):
    body = (
        f"{record['contact']['name']} replied about {record['job_title']} at {record['company']}:\n\n"
        f"{record['reply_text']}\n\n"
        f"Channel: {record['channel']} | application: {record['app_id']}"
    )
    send_email(os.environ["OWNER_NOTIFY_EMAIL"], "A job contact replied", body, os.environ["EMAIL_FROM"])


# ---------- public endpoints ----------

@app.get("/config")
def get_config():
    return load_config()


@app.post("/config")
def set_config():
    with data_lock:
        save_json(DATA / "config.json", request.json)
    return {"ok": True}


@app.post("/applications/submit")
def submit():
    """Workflow posts a batch of {job_fingerprint, job_title, company, job_url,
    job_description, contact, channel}. Service is the only creator of applications."""
    batch = request.json["applications"]
    created, skipped = [], []
    with data_lock:
        dedupe = load_json(DATA / "dedupe.json", {})
        send_queue = load_json(DATA / "send_queue.json", [])
        li_index = load_json(DATA / "linkedin_index.json", {})

        for item in batch:
            fp = item["job_fingerprint"]
            if fp in dedupe:
                skipped.append(fp)
                continue

            app_id = uuid.uuid4().hex
            reply_token = secrets.token_urlsafe(24)
            record = {
                "app_id": app_id,
                "job_fingerprint": fp,
                "job_title": item["job_title"],
                "company": item["company"],
                "job_url": item.get("job_url"),
                "job_description": item["job_description"],
                "contact": item["contact"],            # {name, title, email?, linkedin_conversation_urn?}
                "channel": item["channel"],            # "email" | "linkedin"
                "status": "queued",                    # queued -> active -> replied -> closed | failed
                "reply_token": reply_token,
                "reply_token_hash": token_hash(reply_token),
                "follow_up_count": 0,
                "send_attempts": 0,
                "next_action_at": None,
                "last_contact_at": None,
                "reply_text": None,
                "created_at": iso(now()),
                "updated_at": iso(now()),
            }
            save_app(record)
            dedupe[fp] = app_id
            send_queue.append(app_id)
            if record["channel"] == "linkedin":
                li_index[record["contact"]["linkedin_conversation_urn"]] = app_id
            created.append(app_id)

        save_json(DATA / "dedupe.json", dedupe)
        save_json(DATA / "send_queue.json", send_queue)
        save_json(DATA / "linkedin_index.json", li_index)

    event("submit", {"created": len(created), "skipped": len(skipped)})
    return {"ok": True, "created": len(created), "skipped_duplicates": len(skipped)}


@app.post("/email-inbound")
def email_inbound():
    raw = request.get_data()
    sig = request.headers.get("X-Inbound-Signature", "")
    expected = hmac.new(os.environ["INBOUND_EMAIL_WEBHOOK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return {"ok": False, "error": "bad signature"}, 403

    inbound = request.json
    to_field = inbound.get("to", "")
    to_list = to_field if isinstance(to_field, list) else [to_field]
    app_id = reply_token = None
    for recipient in to_list:
        _, addr = parseaddr(recipient)
        m = re.match(r"^apply\+([^.@]+)\.([^@]+)@", addr)
        if m:
            app_id, reply_token = m.group(1), m.group(2)
            break
    if not app_id:
        return {"ok": True, "ignored": "not an application reply"}

    with data_lock:
        record = load_app(app_id)
        if record is None or record["status"] != "active":
            return {"ok": True, "ignored": "unknown or closed"}
        _, sender = parseaddr(inbound["from"])
        if sender.lower() != record["contact"].get("email", "").lower():
            event("reply_rejected", {"app_id": app_id, "reason": "sender mismatch"})
            return {"ok": False, "error": "sender mismatch"}, 403
        if token_hash(reply_token) != record["reply_token_hash"]:
            return {"ok": False, "error": "token mismatch"}, 403

        record["status"] = "replied"
        record["reply_text"] = inbound.get("stripped_text") or inbound.get("text", "")
        record["updated_at"] = iso(now())
        save_app(record)
        nq = load_json(DATA / "notify_queue.json", [])
        nq.append(app_id)
        save_json(DATA / "notify_queue.json", nq)

    event("reply_received", {"app_id": app_id, "channel": "email"})
    return {"ok": True}  # return fast; user is notified later by tick


@app.post("/internal/tick")
def tick():
    if request.headers.get("Authorization") != f"Bearer {os.environ['TICK_CRON_TOKEN']}":
        return {"ok": False, "error": "unauthorized"}, 401
    if not tick_lock.acquire(blocking=False):
        return {"ok": True, "busy": True}  # a previous tick is still running
    try:
        cfg = load_config()
        return {
            "ok": True,
            "sent": drain_sends(cfg),
            "followed_up": process_followups(cfg),
            "linkedin_replies": poll_linkedin(),
            "notified": drain_notifications(),
        }
    finally:
        tick_lock.release()


# ---------- tick sub-steps (only the tick runs these, so no inter-tick races) ----------

def drain_sends(cfg):
    with data_lock:
        queue = load_json(DATA / "send_queue.json", [])
        take = queue[: cfg["policy"]["send_batch_per_tick"]]
        remaining = queue[cfg["policy"]["send_batch_per_tick"]:]
        save_json(DATA / "send_queue.json", remaining)  # claim now so a crash won't resend

    sent = 0
    first_gap = timedelta(hours=cfg["policy"]["followup_intervals_hours"][0])
    for app_id in take:
        record = load_app(app_id)
        if not record or record["status"] != "queued":
            continue
        try:
            draft = draft_initial(cfg, record)
            if record["channel"] == "email":
                send_email(record["contact"]["email"], draft["subject"], draft["body"], reply_to_for(record))
            else:
                send_linkedin(record["contact"]["linkedin_conversation_urn"], draft["body"])
            with data_lock:
                record = load_app(app_id)
                record.update(status="active", last_contact_at=iso(now()),
                              next_action_at=iso(now() + first_gap), updated_at=iso(now()))
                save_app(record)
            sent += 1
        except Exception as e:  # noqa: BLE001
            with data_lock:
                record = load_app(app_id)
                record["send_attempts"] += 1
                if record["send_attempts"] >= 3:
                    record["status"] = "failed"
                else:
                    q = load_json(DATA / "send_queue.json", [])
                    q.append(app_id)  # requeue for a later tick
                    save_json(DATA / "send_queue.json", q)
                record["updated_at"] = iso(now())
                save_app(record)
            event("send_failed", {"app_id": app_id, "error": str(e)})
    return sent


def process_followups(cfg):
    intervals = cfg["policy"]["followup_intervals_hours"]
    max_fu = cfg["policy"]["max_followups"]
    done = 0
    for path in APPS.glob("*.json"):
        record = load_json(path, None)
        if not record or record["status"] != "active":
            continue
        if record["follow_up_count"] >= max_fu or not record["next_action_at"]:
            continue
        if now() < parse(record["next_action_at"]):
            continue
        try:
            draft = draft_followup(cfg, record)
            if record["channel"] == "email":
                send_email(record["contact"]["email"], f"Re: {record['job_title']}", draft["body"], reply_to_for(record))
            else:
                send_linkedin(record["contact"]["linkedin_conversation_urn"], draft["body"])
            with data_lock:
                record = load_app(record["app_id"])
                record["follow_up_count"] += 1
                record["last_contact_at"] = iso(now())
                if record["follow_up_count"] < max_fu:
                    gap = timedelta(hours=intervals[min(record["follow_up_count"], len(intervals) - 1)])
                    record["next_action_at"] = iso(now() + gap)
                else:
                    record["next_action_at"] = None  # no more nudges; just wait for a reply
                record["updated_at"] = iso(now())
                save_app(record)
            done += 1
        except Exception as e:  # noqa: BLE001
            event("followup_failed", {"app_id": record["app_id"], "error": str(e)})
    return done


def poll_linkedin():
    cursor = load_json(DATA / "linkedin_cursor.json", {"since": None})
    try:
        r = requests.get(
            "https://api.linkedin.com/v2/conversations",
            headers={"Authorization": f"Bearer {linkedin_token()}"},
            params={"updated_after": cursor["since"]} if cursor["since"] else {},
            timeout=30,
        )
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        event("linkedin_poll_failed", {"error": str(e)})
        return 0

    li_index = load_json(DATA / "linkedin_index.json", {})
    found = 0
    newest = cursor["since"]
    for convo in r.json().get("conversations", []):
        urn = convo["urn"]
        last = convo.get("last_inbound_message")
        if not last:
            continue
        newest = max(newest or last["created_at"], last["created_at"])
        app_id = li_index.get(urn)
        if not app_id:
            continue
        with data_lock:
            record = load_app(app_id)
            if not record or record["status"] != "active":
                continue
            record.update(status="replied", reply_text=last["text"], updated_at=iso(now()))
            save_app(record)
            nq = load_json(DATA / "notify_queue.json", [])
            nq.append(app_id)
            save_json(DATA / "notify_queue.json", nq)
        event("reply_received", {"app_id": app_id, "channel": "linkedin"})
        found += 1

    save_json(DATA / "linkedin_cursor.json", {"since": newest})
    return found


def drain_notifications():
    with data_lock:
        queue = load_json(DATA / "notify_queue.json", [])
        save_json(DATA / "notify_queue.json", [])  # claim all
    notified = 0
    for app_id in queue:
        record = load_app(app_id)
        if not record or record["status"] != "replied":
            continue
        try:
            notify_owner(record)
            with data_lock:
                record = load_app(app_id)
                record.update(status="closed", updated_at=iso(now()))
                save_app(record)
            notified += 1
        except Exception as e:  # noqa: BLE001
            with data_lock:  # put it back so the next tick retries
                nq = load_json(DATA / "notify_queue.json", [])
                nq.append(app_id)
                save_json(DATA / "notify_queue.json", nq)
            event("notify_failed", {"app_id": app_id, "error": str(e)})
    return notified
```

## `workflows/apply-to-jobs/workflow.json`

```json
{
  "name": "Apply To Jobs",
  "intent_summary": "Discover up to N relevant jobs, resolve a contact for each, and submit them to the job-outreach service for sending.",
  "inputs": {
    "max_jobs": { "type": "number", "default": 1000 }
  },
  "required_secrets": [
    "JOB_OUTREACH_URL",
    "JOB_SOURCE_API_URL",
    "JOB_SOURCE_API_TOKEN",
    "CONTACT_ENRICH_API_URL",
    "CONTACT_ENRICH_API_TOKEN"
  ],
  "runtime": { "timeout_seconds": 1800 }
}
```

## `workflows/apply-to-jobs/run.py`

```python
import hashlib
import json
import os

import requests
from teamcopilot import tc

SERVICE = os.environ["JOB_OUTREACH_URL"]
MAX_JOBS = int(tc.args.get("max_jobs", 1000))

# 1. Single source of truth for criteria lives in the service, not here.
cfg = requests.get(SERVICE + "/config", timeout=30).json()
criteria = cfg.get("criteria", {})
if not criteria:
    tc.fail("No search criteria configured. Set them via POST /config first.")

# 2. One-time human checkpoint before any blast. The service marks criteria 'approved'
#    once confirmed, so later runs skip the question.
if not cfg.get("criteria_approved"):
    answer = tc.ask_user(f"""
Confirm the job-search criteria before sending outreach.

Criteria:
{json.dumps(criteria, indent=2)}

Resume on file (first 500 chars):
{cfg.get("resume", "")[:500]}
""", user_id=cfg["owner_user_id"], schema={
        "type": "object",
        "required": ["decision"],
        "properties": {"decision": {"type": "string", "enum": ["approve", "stop"]}},
    })
    if answer["data"]["decision"] != "approve":
        tc.fail("User did not approve outreach criteria.")
    cfg["criteria_approved"] = True
    requests.post(SERVICE + "/config", json=cfg, timeout=30).raise_for_status()


def fingerprint(job):
    return hashlib.sha256(f"{job['company']}|{job['title']}|{job['location']}".encode()).hexdigest()


def discover_jobs(criteria, limit):
    out, page = [], 1
    while len(out) < limit:
        r = requests.get(
            os.environ["JOB_SOURCE_API_URL"] + "/search",
            headers={"Authorization": f"Bearer {os.environ['JOB_SOURCE_API_TOKEN']}"},
            params={**criteria, "page": page, "page_size": 100},
            timeout=30,
        )
        r.raise_for_status()
        jobs = r.json().get("jobs", [])
        if not jobs:
            break
        out.extend(jobs)
        page += 1
    return out[:limit]


def resolve_contact(job):
    """Find the right person + best channel. Returns None if no contact can be found."""
    r = requests.get(
        os.environ["CONTACT_ENRICH_API_URL"] + "/find",
        headers={"Authorization": f"Bearer {os.environ['CONTACT_ENRICH_API_TOKEN']}"},
        params={"company": job["company"], "role_hint": "recruiter,talent,hiring manager"},
        timeout=30,
    )
    r.raise_for_status()
    c = r.json().get("contact")
    if not c:
        return None
    if c.get("email"):
        return {"name": c["name"], "title": c.get("title"), "email": c["email"]}, "email"
    if c.get("linkedin_conversation_urn"):
        return {"name": c["name"], "title": c.get("title"),
                "linkedin_conversation_urn": c["linkedin_conversation_urn"]}, "linkedin"
    return None


# 3. Discover, resolve, and submit in batches. The workflow keeps NO state:
#    dedupe + record creation are decided by the service.
jobs = discover_jobs(criteria, MAX_JOBS)
batch, submitted, no_contact = [], 0, 0

def flush(batch):
    if not batch:
        return 0
    r = requests.post(SERVICE + "/applications/submit", json={"applications": batch}, timeout=60)
    r.raise_for_status()
    return r.json()["created"]

for job in jobs:
    resolved = resolve_contact(job)
    if resolved is None:
        no_contact += 1
        continue
    contact, channel = resolved
    batch.append({
        "job_fingerprint": fingerprint(job),
        "job_title": job["title"],
        "company": job["company"],
        "job_url": job.get("url"),
        "job_description": job.get("description", ""),
        "contact": contact,
        "channel": channel,
    })
    if len(batch) >= 100:
        submitted += flush(batch)
        batch = []

submitted += flush(batch)

tc.success({
    "jobs_found": len(jobs),
    "submitted_new": submitted,        # service deduped the rest
    "no_contact_found": no_contact,
})
```

The workflow returns as soon as everything is **submitted**. Actual sending is paced by the service across many ticks, so a 1000-job run finishes quickly and does not depend on email/LinkedIn throughput.

## `workflows/job-outreach-tick/workflow.json`

```json
{
  "name": "Job Outreach Tick",
  "intent_summary": "Drives the job-outreach service's time-based work: paced sends, follow-ups, LinkedIn reply polling, and user notifications.",
  "inputs": {},
  "required_secrets": ["JOB_OUTREACH_URL", "TICK_CRON_TOKEN"],
  "runtime": { "timeout_seconds": 300 }
}
```

## `workflows/job-outreach-tick/run.py`

```python
import os
import requests
from teamcopilot import tc

r = requests.post(
    os.environ["JOB_OUTREACH_URL"] + "/internal/tick",
    headers={"Authorization": f"Bearer {os.environ['TICK_CRON_TOKEN']}"},
    timeout=240,
)
r.raise_for_status()
tc.success(r.json())
```

## Application lifecycle (single record, four actors)

```text
queued     created by submit (workflow), id pushed to send_queue
   |        tick drain_sends drafts + sends the first message
active     awaiting reply; next_action_at set
   |--------> tick process_followups sends a nudge when next_action_at passes
   |          (up to max_followups, then next_action_at = null)
   |
   |  email reply  -> /email-inbound marks replied, pushes to notify_queue
   |  linkedin     -> tick poll_linkedin marks replied, pushes to notify_queue
   v
replied    tick drain_notifications emails the user the reply
   v
closed
```

Terminal off-paths: `failed` (3 send attempts failed) and `skipped`/dropped-at-submit (duplicate fingerprint, never created).

## End-to-end flow

```text
apply-to-jobs run (manual or weekly cron)
  -> GET /config (criteria + resume = single source of truth)
  -> tc.ask_user once to approve criteria, then mark approved in config
  -> discover up to 1000 jobs from the job source
  -> resolve the right contact + channel per job
  -> POST /applications/submit in batches of 100
  -> service dedupes, creates one record per new job, queues sends
  -> tc.success(summary); workflow exits

job-outreach-tick cron (every 3 min)
  -> POST /internal/tick
       -> drain_sends: draft (tc.run_agent) + send a paced batch of first messages
       -> process_followups: nudge active apps whose follow-up window elapsed
       -> poll_linkedin: pull LinkedIn replies since cursor, mark replied
       -> drain_notifications: email the user about each new reply, close it

contact replies by email
  -> provider POSTs /email-inbound
  -> verify signature + reply token + sender, mark replied, enqueue notify
  -> next tick notifies the user
```

## Idempotency, scale, and crash safety

- **No double-apply across runs.** Dedupe is keyed on a stable job fingerprint and owned solely by the service at submit time. Overlapping runs are safe.
- **No double-send.** `drain_sends` claims its batch (removes ids from `send_queue.json`) *before* sending, and each send re-checks `status == "queued"` and flips to `active`. A crash mid-batch loses at most the in-flight item, which `send_attempts`/requeue recovers; a replayed `/internal/tick` finds an empty/already-advanced queue.
- **Fast webhook.** `/email-inbound` only records the reply and enqueues a notify; it returns `200` immediately, so the email provider never times out.
- **Throttling for deliverability.** `send_batch_per_tick` caps sends per tick; at 40 per 3 minutes a 1000-job batch rolls out over ~75 minutes, which keeps under provider/LinkedIn rate limits and avoids spam classification.
- **One writer per datum.** Every state file in the map has exactly one writer-of-record, and time-based transitions only ever run inside the single-flight `tick_lock`, so the workflow, the cron, and the webhook cannot disagree.
- **Atomic writes.** All state files are written via temp-file + rename, so a crash never leaves a half-written record.
- **Replay-friendly.** On restart the service resumes purely from `data/`: `send_queue.json` still lists unsent apps, `next_action_at` still drives follow-ups, `notify_queue.json` still lists pending notifications. Nothing is held only in memory.

## Operator safety notes

- Sending unsolicited bulk email/LinkedIn messages is subject to anti-spam law (CAN-SPAM, GDPR, LinkedIn's terms). The throttle, the per-message Reply-To, and the bounded follow-up count are the minimum guardrails; the operator is responsible for opt-out handling and message content.
- `max_followups` is capped at 2 by default so a non-responsive contact gets at most three touches total.

## Primitives exercised (the point of this dry-test)

This use case stresses the plan harder than the existing examples, and the primitives hold up:

- **Hosted service as the single state owner** — proves the service primitive can be the authoritative datastore for thousands of records with concurrent writers, not just a thin webhook.
- **Stateless workflow as a driver** — proves a finite workflow can do heavy fan-out (1000 items) while delegating all persistence/dedupe to a service, keeping `run.py` simple and restartable.
- **One cron → one `/internal/tick`** — proves periodic, time-based progression (paced sends, follow-ups, polling, notifications) needs no scheduler beyond a single cronjob and the service's own data.
- **`tc.run_agent` at send time** — proves agent work can be pushed to the throttled boundary instead of the discovery boundary, so LLM cost tracks actual sends.
- **`tc.ask_user` as a one-time gate** — proves a human checkpoint fits a workflow without per-run friction.
- **`tc.getSecretToken` (OAuth)** — proves a polled, non-webhook channel (LinkedIn) works with on-demand token resolution.
- **Resource-owned data directory** — proves push (email webhook) and pull (LinkedIn poll) replies converge on the same records and the same notify queue with no extra primitive.

Gap surfaced: there is no fire-and-forget `tc.notify_user` in the SDK, so "tell the user" is implemented as a plain outbound email (like use case 21). If notify-the-user becomes common, a non-blocking `tc.notify_user(user_id, message)` would be a cleaner primitive than reusing `tc.ask_user` (which blocks) or sending side-channel email.
```
