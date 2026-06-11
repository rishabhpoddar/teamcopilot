# GitHub PR Review Bot

## Goal

Receive GitHub pull request webhooks, run an agent review, then post review comments or approve the PR.

This should be one hosted service. It does not need a workflow because the event starts in a webhook service, and the service can call the shared SDK directly.

## Primitives

- Hosted service: receives GitHub webhooks and performs the whole flow.
- Service data directory: dedupes GitHub delivery ids.

## Resources

```text
services/github-pr-reviewer/
  service.json
  server.py
  data/deliveries/
```

## `services/github-pr-reviewer/service.json`

```json
{
  "name": "GitHub PR Reviewer",
  "runtime": "python",
  "entrypoint": "server.py",
  "public_path": "/services/github-pr-reviewer",
  "required_secrets": ["GITHUB_WEBHOOK_SECRET", "GITHUB_TOKEN"]
}
```

## `services/github-pr-reviewer/server.py`

```python
import hashlib, hmac, json, os, requests
from pathlib import Path
from flask import Flask, request
from teamcopilot import tc

app = Flask(__name__)

data_dir = Path("data")
deliveries_dir = data_dir / "deliveries"
deliveries_dir.mkdir(parents=True, exist_ok=True)

def github_headers():
    return {
        "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

def verify_signature(raw_body, signature):
    expected = "sha256=" + hmac.new(
        os.environ["GITHUB_WEBHOOK_SECRET"].encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature or "")

def fetch_changed_files(owner, repo, pull_number):
    response = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}/files",
        headers=github_headers(),
        timeout=30,
    )
    response.raise_for_status()
    files = response.json()

    patches = []
    for file in files:
        if file["status"] == "removed" or not file.get("patch"):
            continue
        patches.append({
            "filename": file["filename"],
            "status": file["status"],
            "additions": file["additions"],
            "deletions": file["deletions"],
            "patch": file["patch"][:12000],
        })
    return patches

def post_review(owner, repo, pull_number, head_sha, review):
    findings = review["findings"]
    if findings:
        comments = [
            {
                "path": finding["path"],
                "line": finding["line"],
                "body": f"{finding['severity'].upper()}: {finding['message']}\n\nSuggestion: {finding['suggestion']}",
            }
            for finding in findings
        ]
        response = requests.post(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
            headers=github_headers(),
            json={
                "commit_id": head_sha,
                "body": review["summary"],
                "event": "COMMENT",
                "comments": comments,
            },
            timeout=30,
        )
        response.raise_for_status()
        return {"action": "commented", "review_id": response.json()["id"], "finding_count": len(findings)}

    if review["approval_recommended"]:
        response = requests.post(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
            headers=github_headers(),
            json={
                "commit_id": head_sha,
                "body": review["summary"] or "Automated agent review found no blocking issues.",
                "event": "APPROVE",
            },
            timeout=30,
        )
        response.raise_for_status()
        return {"action": "approved", "review_id": response.json()["id"]}

    response = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/issues/{pull_number}/comments",
        headers=github_headers(),
        json={"body": review["summary"] or "Automated agent review completed with no inline findings."},
        timeout=30,
    )
    response.raise_for_status()
    return {"action": "summary_comment", "comment_id": response.json()["id"]}

@app.post("/webhook")
def webhook():
    raw_body = request.get_data()
    if not verify_signature(raw_body, request.headers.get("X-Hub-Signature-256")):
        return {"ok": False, "error": "invalid signature"}, 401

    if request.headers.get("X-GitHub-Event") != "pull_request":
        return {"ok": True, "ignored": request.headers.get("X-GitHub-Event")}

    payload = request.json
    if payload["action"] not in ["opened", "reopened", "synchronize", "ready_for_review"]:
        return {"ok": True, "ignored": payload["action"]}

    delivery_id = request.headers["X-GitHub-Delivery"]
    delivery_path = deliveries_dir / f"{delivery_id}.txt"
    if delivery_path.exists():
        return {"ok": True, "duplicate": True}
    delivery_path.write_text("seen")

    pr = payload["pull_request"]
    if pr["draft"]:
        return {"ok": True, "skipped": "draft_pr"}

    owner, repo = payload["repository"]["full_name"].split("/", 1)
    pull_number = pr["number"]
    patches = fetch_changed_files(owner, repo, pull_number)
    if not patches:
        return {"ok": True, "skipped": "no_reviewable_patches"}

    review_reply = tc.run_agent(f"""
        Review this GitHub PR diff. Focus only on concrete correctness, security,
        data-loss, production reliability, and meaningful test-coverage issues.
        Do not comment on style or harmless refactors.

        Repository: {payload["repository"]["full_name"]}
        Pull number: {pull_number}
        Base ref: {pr["base"]["ref"]}
        Head ref: {pr["head"]["ref"]}
        Head SHA: {pr["head"]["sha"]}
        Changed files:
        {json.dumps(patches, indent=2)}

        """, schema={
            "type": "object",
            "required": ["summary", "approval_recommended", "findings"],
            "properties": {
                "summary": {"type": "string"},
                "approval_recommended": {"type": "boolean"},
                "findings": {"type": "array"},
            },
        })
    review = review_reply["data"]

    action = post_review(owner, repo, pull_number, pr["head"]["sha"], review)
    return {"ok": True, "result": action}
```

## Flow

```text
GitHub pull_request webhook
  -> service verifies signature
  -> service dedupes X-GitHub-Delivery in data/deliveries
  -> service fetches changed files from GitHub
  -> service calls tc.run_agent for structured PR review
  -> service posts inline comments if findings exist
  -> service approves the PR if no findings and approval is recommended
```
