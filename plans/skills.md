 ## Custom Skill System (Independent of OpenCode Skill Cache)

  ### Summary

  Build a LocalTool-managed skills system under workspace_dir/.custom-skills with workflow-like governance:

  1. Skills are files/folders managed by LocalTool (not OpenCode’s native .opencode/skills loader).
  2. Access uses per-skill allowlist.
  3. Approval lifecycle matches workflows: pending until Engineer approval.
  4. A custom tool returns only skills the current user can access (name + description), avoiding OpenCode stale-skill caching.
  5. Update workspace AGENTS.md so the agent always calls this tool first.

  ### Public Interfaces / APIs

  1. New REST router: src/skills/index.ts, mounted at /api/skills.
  2. New endpoints:
      - GET /api/skills
          - Returns all skills user can view in dashboard, with approval + permission summary fields.
      - POST /api/skills
          - Creates .custom-skills/<slug>/SKILL.md (pending approval by default).
      - GET /api/skills/:slug
      - PATCH /api/skills/:slug
      - DELETE /api/skills/:slug (ownership/Engineer policy aligned with workflows)
      - POST /api/skills/:slug/approve
      - POST /api/skills/:slug/reject-restore
      - PATCH /api/skills/:slug/access-permissions
      - GET /api/skills/users (picker data)
  3. New plugin-facing endpoint:
      - GET /api/skills/available
          - Auth via session token (Authorization: Bearer <opencode_session_id>)
          - Returns only approved + allowed skills:
              - [{ slug, name, description }]
  4. New custom tool in workspace plugin:
      - listAvailableSkills
      - Calls GET /api/skills/available and returns JSON list.
  5. Add workflow-parity custom tools:
      - createSkill (similar to createWorkflow)
      - findSkill (similar to findWorkflow)

  ### Data / Schema Changes (Prisma)

  Add skill equivalents of workflow metadata/snapshots/permissions:

  1. skill_metadata
      - skill_slug PK
      - created_by_user_id, approved_by_user_id
      - access_permission_mode (restricted only for now, optional future everyone)
      - timestamps
  2. skill_access_permission_users
      - unique (skill_slug, user_id)
  3. skill_approved_snapshots
  4. skill_approved_snapshot_files

  Behavior parity:

  - New skill/edit => pending state until engineer approval.
  - On approve: snapshot current skill folder.
  - On reject-restore: restore last approved snapshot.
  - Access checks use allowlist + lifecycle state.

  ### Filesystem Contract

  1. Root: <workspace>/.custom-skills/
  2. Each skill: <workspace>/.custom-skills/<slug>/
  3. Required file: SKILL.md (frontmatter includes name, description)
  4. Optional supporting files allowed inside skill folder for future use.

  ### Backend Modules

  1. src/utils/skill.ts
      - path resolution, slug listing, manifest/frontmatter read/write
  2. src/utils/skill-files.ts
      - tree/content read/write (same safety model as workflow files)
  3. src/utils/skill-permissions.ts
  4. src/utils/skill-approval-snapshot.ts
  5. src/types/skill.ts
      - SkillSummary, SkillManifest, permission + approval response types

  ### Plugin + Agent Behavior

  1. Add workspace plugin file:
     src/workspace_files/.opencode/plugins/listAvailableSkills.ts
  2. Tool result format:
      - [{ slug, name, description }] only (no full content).
  3. Tool parity with workflows:
      - createSkill should mirror createWorkflow semantics for creating a skill package.
      - findSkill should mirror findWorkflow semantics for locating/selecting a skill.
  4. Session-start context behavior:
      - On every new session start, inject the full list of available skills for the current user into context by default.
  5. Update src/workspace_files/AGENTS.md:
      - Add rule: before any “use a skill” action, call listAvailableSkills.
      - If a skill is selected, read its SKILL.md from .custom-skills/<slug>/SKILL.md.
      - Do not use OpenCode native skill tool for LocalTool custom skills.
      - Security constraint: the agent must never discover/search skills via bash/filesystem scanning; skill discovery must only use listAvailableSkills or findSkill.

  ### Frontend Changes

  1. Add new dashboard tab: Browse skills.
  2. New components:
      - frontend/src/components/dashboard/SkillsSection.tsx
      - frontend/src/components/dashboard/SkillCard.tsx
  3. Capabilities:
      - list/filter skills
      - create skill
      - manage approval state
      - manage allowlist permissions
      - when viewing/editing a skill, use the same code view + project explorer UI used for workflow view/edit
      - apply the same masking rules as workflows
      - apply the same snapshot hash calculation rules as workflows
  4. Networking rules follow repo conventions:
      - GET errors inline (setError)
      - non-GET errors via toast
      - all calls through axiosInstance + bearer token from useAuth

  ### Migration / Initialization

  1. Add Prisma migration for new skill tables.
  2. Ensure workspace init creates .custom-skills/ directory.
  ### Test Scenarios
  1. Creation:
      - create skill => pending, creator in allowlist.
  2. Approval:
      - Engineer approves => visible to allowed users via listAvailableSkills.
  3. Permission enforcement:
      - non-allowed user cannot see skill in available.
  4. Edit lifecycle:
      - edit approved skill => pending again.
  5. Reject restore:
      - revert to last approved snapshot.
  6. Duplicate slug/name handling:
      - 409 conflict.
  7. Plugin flow:
      - listAvailableSkills returns only {slug,name,description} for current user.
  8. UI:
      - browse/create/approval/permissions paths; empty/error states.

  ### Assumptions / Defaults

  1. Access model is per-skill allowlist (no “everyone” in MVP unless needed for parity).
  2. Approval lifecycle matches workflows.
  3. Custom skills live only in workspace_dir/.custom-skills.
  4. Agent uses LocalTool custom tool + file reads, not OpenCode native skill index.
