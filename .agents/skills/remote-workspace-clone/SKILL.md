---
name: remote-workspace-clone
description: Clone a remote workspace snapshot into this repo for local debugging. Use when the user wants to mirror a live remote instance locally, restore workspace data, or diagnose chat/session behavior against a copied environment.
---

# Remote Workspace Clone

Use this skill when you need to reproduce a remote workspace locally for debugging without touching the live remote machine.
This skill is for the repo-root working copy only. Do not apply these steps to the live remote host.

## Goal

Create a local copy of a remote workspace, point the local app at that copy, rewrite any copied path metadata that still references the remote root, and verify the UI against the restored local data.

## Quick Path

If you need the shortest possible runbook, do these in order:

1. Copy the remote workspace into `<local-target>`.
2. Set repo-root `WORKSPACE_DIR=./<local-target>`.
3. Remove any copied package self-reference from `<local-target>/package.json`.
4. Rewrite `<local-target>/.opencode/xdg-data/opencode/opencode.db` so the copied rows point at the local path.
5. Restart the dev server with `npm run dev`.
6. Verify:
   - `sqlite3 <local-target>/.sqlite/data.db "select count(*) from chat_sessions;"`
   - `curl -s http://localhost:5124/api/chat/sessions -H 'Authorization: Bearer <token>'`
   - `curl -s http://localhost:4096/session?directory=<absolute-local-target>`

## Steps

1. Identify the remote workspace root and the local target directory in this repo.
2. Copy the remote workspace into the local target using SSH plus `tar` or an equivalent streaming transfer.
3. Keep the copied snapshot self-contained in the repo. Do not modify the remote machine as part of the debugging setup.
4. Repoint local config to the copied workspace.
5. Rewrite any copied workspace metadata that still hardcodes the remote absolute path.
6. Restart the local dev server after path changes so the backend reloads the copied snapshot.
7. Verify the local workspace by checking:
   - the filesystem copy exists
   - the local database contains the expected rows
   - the session list API returns the restored chats

## Exact Commands

Replace the placeholders below with the actual remote host, remote path, and local target path.

### 1. Copy the remote workspace

```bash
rm -rf <local-target>.new
mkdir -p <local-target>.new
ssh <remote-host> 'cd <remote-workspace-root> && tar -cf - .' | tar -xf - -C <local-target>.new
mv <local-target> <local-target>.prev
mv <local-target>.new <local-target>
```

Use this pattern when you want a single snapshot copy.

### 2. Point the local repo at the copied workspace

Edit the repo-root `.env` so `WORKSPACE_DIR` points at the copied directory:

```bash
WORKSPACE_DIR=./<local-target>
```

If the copied workspace has its own `.env`, make its workspace-relative path local:

```bash
WORKSPACE_DIR=.
```

If you need to confirm what the backend will read, run:

```bash
cat .env
cat <local-target>/.env
```

### 3. Remove copied package self-reference if needed

If the copied workspace package metadata still depends on the published app package, remove that dependency:

```bash
node -e "const fs=require('fs'); const p='<local-target>/package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); delete (j.dependencies||{}).<app-package-name>; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\\n');"
```

If the workspace has another package manager layout, make the equivalent edit in the copied package metadata and remove the self-reference by hand.

To inspect the copied file before editing, use:

```bash
cat <local-target>/package.json
```

### 4. Rewrite copied OpenCode metadata

If the copied OpenCode store still points at the remote absolute path, update it to the local path and local workspace ids:

```bash
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db <<'SQL'
BEGIN;
UPDATE session
SET project_id='<local-project-id>',
    workspace_id='<local-project-id>',
    directory='<absolute-local-target>'
WHERE project_id='global'
   OR workspace_id IS NULL
   OR directory='<remote-absolute-path>';
COMMIT;
SQL
```

If the copied store also has a `project` or `workspace` row that still hardcodes the remote path, update those rows to match the local directory as well.

Before rewriting, inspect the current keys:

```bash
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, worktree, vcs, name from project;"
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, branch, project_id, directory from workspace;"
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select count(*) from session; select count(*) from session where directory='<absolute-local-target>';"
```

After rewriting, confirm the sessions now belong to the local workspace:

```bash
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, project_id, workspace_id, directory from session order by time_updated desc limit 5;"
```

### 5. Restart the local dev server

```bash
npm run dev
```

If the backend is already running, stop it first and start it again after the path rewrite.

If the backend fails on startup because the copied workspace reintroduced a package self-reference, fix `<local-target>/package.json` first and rerun `npm run dev`.

## Checkpoints

After each major step, verify the setup instead of assuming it worked.

### Copy verification

```bash
test -d <local-target>
sqlite3 <local-target>/.sqlite/data.db "select count(*) from chat_sessions;"
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select count(*) from session;"
sqlite3 <local-target>/.sqlite/data.db "select id, email from users order by email;"
```

### Local app verification

```bash
curl -s http://localhost:5124/api/workspace
curl -s http://localhost:4096/session?directory=<absolute-local-target>
```

If the app requires auth, use a valid bearer token from the local auth flow when querying `/api/chat/sessions`.

### Session-list verification

```bash
curl -s http://localhost:5124/api/chat/sessions \
  -H 'Authorization: Bearer <token>'
```

Confirm that the response includes the expected chats for the intended user.

If `GET /api/chat/sessions` returns `0` sessions:

1. Check the `WORKSPACE_DIR` in `.env`.
2. Check whether the OpenCode rows still point at the remote path.
3. Check whether the session `updated_at` values are older than the recent window.
4. Check whether the current token belongs to the expected local user.

## What To Adjust After Copying

- Set the repo-root `WORKSPACE_DIR` to the copied workspace directory.
- If the copied workspace contains its own `.env`, make sure it resolves paths relative to the copied directory.
- If the copied workspace package metadata still tries to install or reference the app package itself, remove that self-reference.
- If the copied OpenCode database still stores the old remote root, rewrite those rows to the local workspace path and local project/workspace ids.
- If the local UI hides the chats after a fresh copy, update `chat_sessions.updated_at` so the rows fall into the default recent window.

## Safety Rules

- Never sync from the live remote database as the source of truth for local debugging.
- Treat the local snapshot as the only debugging target once copied.
- If the remote workspace is actively changing, expect log files or other live artifacts to be slightly inconsistent and verify the important DB files separately.

## Common Failure Modes

- The backend is still reading the old `WORKSPACE_DIR`.
- The copied OpenCode store still points at the old remote root.
- The copied workspace is present, but the UI defaults to a recent-time filter and the sessions are older than the window.
- The copied workspace package metadata reintroduces a dependency on the published package version and breaks `npm run dev`.
- The local backend is down, so API checks fail even though the files were copied correctly.
- The copied workspace has sessions, but the authenticated local user is not the one that owns them.

## Verification

- Confirm the local Prisma database points at the copied workspace.
- Confirm the Opencode session list returns sessions for the copied workspace path.
- Confirm `/api/chat/sessions` returns the expected user sessions in the local dev server.

## Reference

See [references/clone-setup.md](references/clone-setup.md) for the full checklist and the exact path-rewrite steps.
