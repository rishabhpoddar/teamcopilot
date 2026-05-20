# Remote Workspace Clone Checklist

## 1. Pick the target

- Choose a local directory inside this repo for the copied workspace.
- Keep the name generic and stable, such as `remote-workspace/`.
- Avoid using the remote machine name or user name in the local folder name.

## 2. Copy the workspace

- Stream the remote folder over SSH with `tar`.
- Exclude large generated dependency trees when they are not needed for the debug snapshot.
- Copy the workspace root, the local data store, and the Opencode state together so the environment is internally consistent.
- If the remote workspace is live, expect warning noise from files that change during transfer.

Example pattern:

```bash
ssh <remote-host> 'cd <remote-workspace-root> && tar -cf - .' | tar -xf - -C <local-target>
```

Recommended local staging flow:

```bash
rm -rf <local-target>.new
mkdir -p <local-target>.new
ssh <remote-host> 'cd <remote-workspace-root> && tar -cf - .' | tar -xf - -C <local-target>.new
mv <local-target> <local-target>.prev
mv <local-target>.new <local-target>
```

## 3. Repoint local configuration

- Set repo-root `WORKSPACE_DIR` to the copied directory.
- If the copied workspace has its own `.env`, make sure paths are relative to the copied directory.
- Restart the local dev server after changing environment files.

Useful inspection commands:

```bash
cat .env
cat <local-target>/.env
```

## 4. Fix copied metadata

The copied workspace may still contain remote absolute paths in the Opencode store.

Rewrite the copied DB so the local instance uses the copied path:

- Update session rows that still point at the old remote workspace root.
- Align `project_id` and `workspace_id` with the local workspace keys.
- Update any `directory` fields that are still set to the remote absolute path.

Then validate the result by querying the local Opencode API for the copied directory.

Recommended SQL shape:

```sql
BEGIN;
UPDATE session
SET project_id='<local-project-id>',
    workspace_id='<local-project-id>',
    directory='<absolute-local-target>'
WHERE project_id='global'
   OR workspace_id IS NULL
   OR directory='<remote-absolute-path>';
COMMIT;
```

Inspect the copied values before and after:

```bash
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, project_id, workspace_id, directory from session order by time_updated desc limit 10;"
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, worktree, vcs, name from project;"
sqlite3 <local-target>/.opencode/xdg-data/opencode/opencode.db "select id, branch, project_id, directory from workspace;"
```

## 5. Restore local app state

- Confirm the copied Prisma database exists under the local workspace.
- Confirm the local user exists in that database.
- Confirm the session rows belong to the expected user.
- If the UI still shows nothing, check whether the default API view is using a recent-time filter that excludes older sessions.

Useful checks:

```bash
sqlite3 <local-target>/.sqlite/data.db "select count(*) from chat_sessions;"
sqlite3 <local-target>/.sqlite/data.db "select id, email from users order by email;"
sqlite3 <local-target>/.sqlite/data.db "select user_id, count(*) from chat_sessions group by user_id order by count(*) desc;"
curl -s http://localhost:5124/api/chat/sessions -H 'Authorization: Bearer <token>'
```

If chats are still missing after a fresh copy:

- check `WORKSPACE_DIR` first
- check the copied OpenCode `session` rows second
- check the local user's `chat_sessions` rows third
- check whether `updated_at` is outside the default recent window last

If the local UI needs the sessions visible immediately, update the copied `chat_sessions.updated_at` values so they land within the recent window:

```bash
sqlite3 <local-target>/.sqlite/data.db <<'SQL'
BEGIN;
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at DESC, created_at DESC) - 1 AS rn
  FROM chat_sessions
  WHERE visible_to_user = 1
)
UPDATE chat_sessions
SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 - ((SELECT rn FROM ranked WHERE ranked.id = chat_sessions.id) * 60000)
WHERE id IN (SELECT id FROM ranked);
COMMIT;
SQL
```

## 6. Common pitfalls

- Copying the workspace but not the hidden data directories.
- Leaving the copied OpenCode DB keyed to the remote absolute path.
- Forgetting to remove a package self-reference that causes `npm install` to fail.
- Assuming an empty session list means data loss before checking the time filter and workspace mapping.
- Forgetting to restart the backend after changing `.env` or the copied metadata.
- Copying a live workspace and assuming the log files will be perfectly stable during transfer.

## 7. Sanity checks

- `WORKSPACE_DIR` points to the copied workspace.
- The local database has the expected number of chat sessions.
- `GET /api/chat/sessions` returns sessions for the intended user.
- `session.list()` from the local Opencode server returns the copied sessions.
- `GET /api/workspace` returns the copied workspace path.
