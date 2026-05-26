---
name: .agents/skills/release-teamcopilot-npm
description: Release TeamCopilot together with a new OpenCode fork asset update. Use this when the user wants to ship a new TeamCopilot version that consumes fresh opencode-fork GitHub release tarballs.
---

# Release TeamCopilot

Use this skill when the task is to ship a new TeamCopilot release.

There are two release modes:

1. Release without any `opencode-fork` changes.
2. Release with a new `opencode-fork` build bundled into TeamCopilot.

Do not invent or bump versions inside this skill unless the user explicitly asks for that.

The TeamCopilot release must stop if `package.json` and `package-lock.json` do not match.

## Mode 1: Release Without OpenCode Fork Changes

Use this when the user is only changing TeamCopilot code and the bundled OpenCode runtime does not need to change.

What this means:
- You do not build or republish `opencode-fork`.
- You reuse the already-published GitHub release tarballs that TeamCopilot is pinned to in `src/utils/opencode-release.ts` and `package.json`.
- You only release TeamCopilot itself.

Workflow:
1. Read `package.json` and confirm the current TeamCopilot `name` and `version`.
2. Make sure the working tree is suitable for release. Do not hide or discard unrelated user changes.
3. Verify the pinned OpenCode release URLs in `src/utils/opencode-release.ts` still point to the intended existing release tag.
4. Regenerate lockfiles if TeamCopilot dependency pins changed:
   - `npm install --package-lock-only`
   - `cd src/workspace_files && npm install --package-lock-only`
5. Run the normal TeamCopilot verification:
   - `npm run test`
   - `npm run build`
6. If the checks pass and the user wants the real release, publish the TeamCopilot package with npm.
7. Create the matching git tag and GitHub release notes for the TeamCopilot release.

Useful commands:
- Check the release version:
  `node -p "require('./package.json').version"`
- Regenerate the root lockfile after dependency edits:
  `npm install --package-lock-only`
- Regenerate the workspace lockfile after dependency edits:
  `cd src/workspace_files && npm install --package-lock-only`
- Run the TeamCopilot test suite:
  `npm run test`
- Run the TeamCopilot build:
  `npm run build`
- Publish the TeamCopilot npm package from the current commit:
  `npm publish`

What to verify:
- `package.json` and `package-lock.json` versions must match.
- The root lockfile should keep `@opencode-ai/sdk` and `opencode-ai` pointed at the currently pinned GitHub tarball URLs.
- `src/workspace_files/package-lock.json` should keep `opencode-ai` pointed at the currently pinned GitHub tarball URL.
- `npm run build` must pass before publishing TeamCopilot.
- `npm run test` must pass before publishing TeamCopilot.

## Mode 2: Release With OpenCode Fork Changes

Use this when the TeamCopilot release must include a new `opencode-fork` build.

What this means:
- You rebuild the OpenCode fork first.
- You package the fork into new GitHub release tarballs.
- You update TeamCopilot to point at the new tarball URLs.
- Then you release TeamCopilot.

Workflow:
1. Read `package.json` and confirm the current TeamCopilot `name` and `version`.
2. Make sure the working tree is suitable for release. Do not hide or discard unrelated user changes.
3. Confirm the OpenCode fork branch is at the intended commit and its version has been rebuilt.
4. Build the OpenCode fork packages:
   - `bun run --cwd opencode-fork/packages/sdk/js build`
   - `bun run --cwd opencode-fork/packages/opencode build`
5. Pack the release assets from the fork and upload them to the `rishabhpoddar/opencode` GitHub release tag used by TeamCopilot.
6. Update the TeamCopilot release URL constants in `src/utils/opencode-release.ts` if the fork release tag changes.
7. Update the root dependencies in `package.json` to point at the new GitHub tarball URLs for `@opencode-ai/sdk` and `opencode-ai`.
8. Update the workspace bootstrap in `src/utils/workspace-sync.ts` and the workspace template in `src/workspace_files/package.json`.
9. Regenerate the lockfiles:
   - `npm install --package-lock-only`
   - `cd src/workspace_files && npm install --package-lock-only`
10. Run the normal TeamCopilot verification:
   - `npm run test`
   - `npm run build`
11. If the checks pass and the user wants the real release, publish the TeamCopilot package with npm.
12. Create the matching git tag and GitHub release notes for the TeamCopilot release.

Useful commands:
- Build the OpenCode SDK package:
  `bun run --cwd opencode-fork/packages/sdk/js build`
- Build the OpenCode CLI/runtime package:
  `bun run --cwd opencode-fork/packages/opencode build`
- Pack the OpenCode SDK tarball:
  `cd opencode-fork/packages/sdk/js && npm pack`
- Pack the OpenCode runtime tarball:
  `cd opencode-fork/packages/opencode && npm pack`
- Upload release assets to GitHub:
  `gh release create <tag> <opencode-ai.tgz> <opencode-ai-sdk.tgz> --repo rishabhpoddar/opencode --target teamcopilot-1.3.7-changes`
- Regenerate the TeamCopilot root lockfile:
  `npm install --package-lock-only`
- Regenerate the TeamCopilot workspace lockfile:
  `cd src/workspace_files && npm install --package-lock-only`
- Run the TeamCopilot test suite:
  `npm run test`
- Run the TeamCopilot build:
  `npm run build`
- Publish the TeamCopilot npm package from the current commit:
  `npm publish`

What to verify:
- `package.json` and `package-lock.json` versions must match.
- `src/utils/opencode-release.ts` must point to the intended OpenCode release tag.
- `@opencode-ai/sdk` in the root lockfile should resolve to the GitHub tarball URL.
- `opencode-ai` in the root lockfile should resolve to the GitHub tarball URL.
- `src/workspace_files/package-lock.json` should also resolve `opencode-ai` from the GitHub tarball URL.
- `npm run build` must pass before publishing TeamCopilot.
- `npm run test` must pass before publishing TeamCopilot.

## Shared Rules

- Treat the TeamCopilot `package.json` version as the source of truth for the TeamCopilot release version.
- Treat the OpenCode fork release tag as the source of truth only when a new fork build is being shipped.
- Stop if `package-lock.json` top-level `version` or `packages[""].version` does not match `package.json`.
- Prefer updating `src/utils/opencode-release.ts` instead of scattering release URLs through the codebase.
- Do not leave stale npm registry URLs for `@opencode-ai/sdk` or `opencode-ai` in any lockfile or manifest.
- Do not use the local `opencode-fork` checkout as a release artifact path.
- Do not publish if tests fail.
- Do not publish if build fails.
- If the user wants a prerelease tag like `beta`, use it for the TeamCopilot npm publish step only.
- After a successful TeamCopilot publish, create a git tag equal to the TeamCopilot version with no prefix.
- Write detailed manual GitHub release notes that summarize the TeamCopilot changes, and include the OpenCode fork update only when mode 2 was used.

## Examples

- Dry run a TeamCopilot-only release:
  `Use /release-teamcopilot-npm to dry-run the next TeamCopilot release without changing opencode-fork.`

- Publish TeamCopilot after an OpenCode fork update:
  `Use /release-teamcopilot-npm to publish the current TeamCopilot version with the new OpenCode fork tarballs.`

- Verify the current pinned OpenCode release is still fine for a TeamCopilot-only change:
  `Use /release-teamcopilot-npm to run the TeamCopilot release checks without rebuilding opencode-fork.`

## Resources

- `src/utils/opencode-release.ts`: centralized OpenCode fork release URL constants
- `OPENCODE_UPGRADE_CHECKLIST.md`: upgrade checklist for OpenCode and workspace runtime changes
- `CONTRIBUTING.md`: local setup instructions for TeamCopilot and `opencode-fork`
