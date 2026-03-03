## Custom Skill System Plan Status

### Completed

1. Prisma + migration
   - Added shared metadata/snapshot tables: `resource_metadata`, `resource_approved_snapshots`, `resource_approved_snapshot_files`.
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
   - Added shared `EditorPage` with thin wrappers (`WorkflowEditorPage`, `SkillEditorPage`).

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
   - `PATCH /api/skills/:slug/permissions`
   - `GET /api/skills/:slug/files/access`
   - `GET /api/skills/:slug/files/tree`
   - `GET /api/skills/:slug/files/content`
   - `PUT /api/skills/:slug/files/content`
   - `POST /api/skills/:slug/files`
   - `POST /api/skills/:slug/files/upload`
   - `PATCH /api/skills/:slug/files/rename`
   - `DELETE /api/skills/:slug/files`
   - Shared users picker endpoint for both skills/workflows:
     - `GET /api/users`

9. Skill approval-state helper parity
   - Added `getSkillSnapshotApprovalState` helper in `src/utils/skill-approval-snapshot.ts`.
   - Skill approval checks now use helper-based snapshot state consistently.

### Pending

1. Access model parity checks
   - Re-check all read/write skill endpoints for strict approval-state parity with workflows.
   - Ensure any remaining edge-case behavior is identical for skill/workflow when status is pending vs approved.

2. Plugin + agent integration (not started)
   - Add `GET /api/skills/available` (session token auth).
   - Add workspace plugin tool `listAvailableSkills`.
   - Add/create parity tools for agent flow (`createSkill`, `findSkill`) if still required.
   - Inject available skills in session-start context.
   - Update workspace `AGENTS.md` with custom-skill discovery rules.

3. API surface cleanup (optional)
   - Consider extracting shared permission API handlers/utilities to remove remaining workflow/skill endpoint duplication.
   - Keep current canonical route naming (`/:slug/permissions`) consistent everywhere.

### Newly Completed

1. Approval workflow parity for skills
   - Added backend:
     - `GET /api/skills/:slug/approval-diff`
     - `POST /api/skills/:slug/approve`
     - `POST /api/skills/:slug/reject-restore`
   - Added frontend route/page:
     - `/skills/:slug/approval-review`
   - Refactored approval snapshot logic into a shared backend helper (`src/utils/approval-snapshot-common.ts`) reused by workflows and skills.
   - Refactored approval review UI into one shared page implementation reused by workflows and skills.
   - Skills approval state now uses snapshot hash parity (same behavior model as workflows).

### Notes from latest audit

1. `Review & Approve` now works for both workflows and skills via the same approval-review UI implementation.
2. Current implementation reuses editor, card, and approval-review UI heavily; major remaining gaps are plugin/agent integration.
3. Permission storage/mode typing and snapshot approval storage are shared between workflows and skills.
