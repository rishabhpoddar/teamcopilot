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

10. Approval workflow parity for skills
   - Added backend:
     - `GET /api/skills/:slug/approval-diff`
     - `POST /api/skills/:slug/approve`
     - `POST /api/skills/:slug/reject-restore`
   - Added frontend route/page:
     - `/skills/:slug/approval-review`
   - Refactored approval snapshot logic into a shared backend helper (`src/utils/approval-snapshot-common.ts`) reused by workflows and skills.
   - Refactored approval review UI into one shared page implementation.
   - Skills approval state now uses snapshot hash parity (same behavior model as workflows).

11. Approval review page wrapper refactor
   - Shared implementation now lives in `frontend/src/pages/ApprovalReviewPage.tsx`.
   - `frontend/src/pages/WorkflowApprovalReviewPage.tsx` is a thin workflow wrapper.
   - `frontend/src/pages/SkillApprovalReviewPage.tsx` is a thin skill wrapper.

12. Snapshot data-folder policy finalization
   - Removed resource-specific hash option plumbing (`exclude_data_paths` is gone).
   - `data/` is globally excluded from approval snapshots for both workflows and skills.
   - Snapshot diff/state/restore flows now ignore `data/` paths consistently.
   - Newly stored approved snapshots do not write `data/` directory contents into snapshot rows.

13. Plugin tool integration (partially complete)
   - Added workspace plugin tool `listAvailableSkills` in `src/workspace_files/.opencode/plugins/listAvailableSkills.ts`.
     - Returns only skills where user has edit access and current code is approved.
   - Added workspace plugin tool `createSkill` in `src/workspace_files/.opencode/plugins/createSkill.ts`.
     - Accepts slug, description, and markdown content.
     - Creates skill via backend (`POST /api/skills`) and writes `SKILL.md` via files API.
     - Includes explicit user permission prompt flow (same request/poll model as `createWorkflow`).
   - Added workspace plugin tool `findSkill` in `src/workspace_files/.opencode/plugins/findSkill.ts`.
     - Searches only skills the user can edit and that are approved.
     - Uses semantic similarity over both skill description and `SKILL.md` body content.
   - Added workspace plugin tool `getSkillContent` in `src/workspace_files/.opencode/plugins/getSkillContent.ts`.
     - Returns `SKILL.md` by slug only when user has access and the skill is approved.

### Pending

1. Plugin + agent integration (remaining)
   - Inject available skills in session-start context.
   - Update workspace `AGENTS.md` in the workspace_files directory with instructions about custom skills and the tools. Also mention in it that the agent should always try and find a skill to use to fulfill the user's request.

2. API surface cleanup (optional)
   - Consider extracting shared permission API handlers/utilities to remove remaining workflow/skill endpoint duplication.
   - Keep current canonical route naming (`/:slug/permissions`) consistent everywhere.

### Notes from latest audit

1. `Review & Approve` now works for both workflows and skills via the same approval-review UI implementation.
2. Current implementation reuses editor, card, and approval-review UI heavily; remaining gap is agent-context/instruction integration for the new skill tools.
3. Permission storage/mode typing and snapshot approval storage are shared between workflows and skills.
4. `data/` directories are intentionally excluded from approval snapshot storage and diffs.
5. Access model note: pending resource edit access intentionally allows Engineers and users who already have resource-use permission.
6. Open security follow-up tracked in issue `#31` (validate skill slugs across all skill routes).
