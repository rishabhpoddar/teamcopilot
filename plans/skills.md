## Custom Skill System Plan Status

### Completed

1. Prisma + migration
   - Added `skill_metadata`, `skill_approved_snapshots`, `skill_approved_snapshot_files`.
   - Added shared permission tables `resource_permissions` + `resource_permission_users` for both workflows and skills.

2. Backend router mounted
   - Added `src/skills/index.ts`.
   - Mounted at `/api/skills` from `src/index.ts`.

3. Workspace initialization
   - Ensures `<workspace>/.custom-skills` exists at startup.

4. Skill filesystem + metadata helpers
   - Added `src/utils/skill.ts`.
   - Added `src/utils/skill-files.ts` for editor tree/content/save/create/rename/delete/upload behavior.
   - Canonical skill manifest is `SKILL.md` (no `skills.md` fallback).
   - Added `src/utils/skill-permissions.ts` backed by shared permission-common utilities.

5. Dashboard and editor UX
   - Added `Browse skills` tab.
   - Added skill listing, filters, empty/error states, create-skill modal.
   - Added skill editor route `/skills/:slug`.
   - Reused workflow editor page for skills (`WorkflowEditorPage` with `entity="skill"` wrapper page).

6. Card reuse
   - Replaced divergent workflow/skill cards with one shared `UnifiedCard` + thin wrappers.
   - Shared action row + permission management UI logic and common permission mode type (`restricted` | `everyone`).

7. Permission system refactor
   - Shared permission logic lives in `src/utils/permission-common.ts`.
   - Shared DB queries for permission reads/ensures/updates are reused by workflow + skill modules.
   - Skill/workflow permission responses are aligned around the same shape and same mode values.

8. Working skill endpoints (current)
   - `GET /api/skills`
   - `POST /api/skills`
   - `GET /api/skills/:slug`
   - `DELETE /api/skills/:slug`
   - `GET /api/skills/users`
   - `PATCH /api/skills/:slug/permissions`
   - `GET /api/skills/:slug/files/access`
   - `GET /api/skills/:slug/files/tree`
   - `GET /api/skills/:slug/files/content`
   - `PUT /api/skills/:slug/files/content`
   - `POST /api/skills/:slug/files`
   - `POST /api/skills/:slug/files/upload`
   - `PATCH /api/skills/:slug/files/rename`
   - `DELETE /api/skills/:slug/files`

### Pending

1. Approval workflow parity for skills
   - Add backend:
     - `GET /api/skills/:slug/approval-diff`
     - `POST /api/skills/:slug/approve`
     - `POST /api/skills/:slug/reject-restore`
   - Add frontend route/page:
     - `/skills/:slug/approval-review` (same UX shape as workflow approval review page).
   - Ensure status for skills is based on snapshot parity (not just approver field).

2. Access model parity checks
   - Re-check all read/write skill endpoints for strict approval-state parity with workflows.
   - Ensure any remaining edge-case behavior is identical for skill/workflow when status is pending vs approved.

3. Plugin + agent integration (not started)
   - Add `GET /api/skills/available` (session token auth).
   - Add workspace plugin tool `listAvailableSkills`.
   - Add/create parity tools for agent flow (`createSkill`, `findSkill`) if still required.
   - Inject available skills in session-start context.
   - Update workspace `AGENTS.md` with custom-skill discovery rules.

4. API surface cleanup (optional)
   - Consider extracting shared permission API handlers/utilities to remove remaining workflow/skill endpoint duplication.
   - Keep current canonical route naming (`/:slug/permissions`) consistent everywhere.

### Notes from latest audit

1. `Review & Approve` for skills points to `/skills/:slug/approval-review`, but that page/flow is not implemented yet.
2. Current implementation reuses editor and card UI heavily; parity gaps are mainly in approval-diff/approve/reject lifecycle and plugin integration.
3. Permission storage and permission mode typing are now shared between workflows and skills.
