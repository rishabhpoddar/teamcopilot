## Custom Skill System Plan Status

### Completed

1. Prisma + migration
   - Added `skill_metadata`, `skill_access_permission_users`, `skill_approved_snapshots`, `skill_approved_snapshot_files`.
   - Added migration and applied it (`20260303040318_add_skill_tables`).

2. Backend router mounted
   - Added `src/skills/index.ts`.
   - Mounted at `/api/skills` from `src/index.ts`.

3. Workspace initialization
   - Ensures `<workspace>/.custom-skills` exists at startup.

4. Skill filesystem + metadata helpers
   - Added `src/utils/skill.ts`.
   - Added `src/utils/skill-files.ts` for editor tree/content/save/create/rename/delete/upload behavior.
   - Added `src/utils/skill-permissions.ts` for allowlist summary + updates.

5. Dashboard and editor UX
   - Added `Browse skills` tab.
   - Added skill listing, filters, empty/error states, create-skill modal.
   - Added skill editor route `/skills/:slug`.
   - Reused workflow editor page for skills (`WorkflowEditorPage` with `entity="skill"` wrapper page).

6. Card reuse
   - Replaced divergent workflow/skill cards with one shared `UnifiedCard` + thin wrappers.
   - Shared action row + permission management UI logic.

7. Working skill endpoints (current)
   - `GET /api/skills`
   - `POST /api/skills`
   - `GET /api/skills/:slug`
   - `DELETE /api/skills/:slug`
   - `GET /api/skills/users`
   - `PATCH /api/skills/:slug/access-permissions`
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
   - Enforce skill visibility/use rules exactly like workflow requirements:
     - non-allowed users should not see/use skill where required.
     - engineers can review pending skills.
   - Re-check all read endpoints for consistent permission enforcement.

3. Plugin + agent integration (not started)
   - Add `GET /api/skills/available` (session token auth).
   - Add workspace plugin tool `listAvailableSkills`.
   - Add/create parity tools for agent flow (`createSkill`, `findSkill`) if still required.
   - Inject available skills in session-start context.
   - Update workspace `AGENTS.md` with custom-skill discovery rules.

4. Contract cleanup
   - Decide and standardize canonical manifest filename:
     - currently create flow writes `skills.md`; earlier design referenced `SKILL.md`.
   - Keep one canonical convention across API/plugin/agent docs.

### Notes from latest audit

1. `Review & Approve` for skills points to `/skills/:slug/approval-review`, but that page/flow is not implemented yet.
2. Current implementation reuses editor and card UI heavily; parity gaps are mainly in approval-diff/approve/reject lifecycle and plugin integration.
