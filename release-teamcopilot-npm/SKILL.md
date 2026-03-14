---
name: release-teamcopilot-npm
description: Publish this repository to npm as TeamCopilot after confirming the release version in package.json. Use this when the user wants to dry-run, verify, or publish a new npm release for this repo.
---

# Release TeamCopilot npm

Use this skill when the task is to release the TeamCopilot package to npm from this repository.

This skill assumes `package.json` already contains the intended release version. Do not invent or bump the version inside this skill unless the user explicitly asks for that.

The release must stop if the version in `package.json` and `package-lock.json` do not match.

## Workflow

1. Read [package.json](../package.json) and confirm the current `name` and `version`.
2. Make sure the working tree is in a state suitable for release (git status is clean and on main branch). Do not hide or discard unrelated user changes.
3. Run the release helper:
   `./release-teamcopilot-npm/scripts/publish.sh`
4. By default, prefer a dry run first:
   `./release-teamcopilot-npm/scripts/publish.sh --dry-run`
5. If the dry run is clean and the user wants the real release, run:
   `./release-teamcopilot-npm/scripts/publish.sh --publish`
6. After a successful publish, create a Git tag that exactly matches the package version, for example `0.0.1`.
7. Use `gh` to create a GitHub release for that tag with release notes based on the changes since the previous release.

## What The Script Does

- Reads the package `name` and `version` from the repo root `package.json`
- Shows the exact release target, for example `teamcopilot@0.0.1`
- Verifies `package.json` and `package-lock.json` have the same version
- Runs `npm whoami` and requires the result to be `rishabhpoddar`
- Runs `npm run test` and requires it to pass
- Runs `npm run build`
- Requires `npm run build` to pass
- Runs `npm pack --json`
- Deletes the generated `.tgz` after verification so the repo is not left dirty
- Publishes with `npm publish` only when `--publish` is passed
- Accepts `--tag <tag>` and `--access public`
- After publish, GitHub tagging and release creation must be done separately with `gh`

## Rules

- Treat the `package.json` version as the source of truth for the release version.
- Stop if `package-lock.json` does not have the same version.
- Prefer `--dry-run` before `--publish`.
- Do not publish if tests fail.
- Do not publish if build fails.
- If `npm whoami` is not `rishabhpoddar`, stop immediately.
- If the user wants a prerelease tag like `beta`, pass `--tag beta`.
- If the package ever becomes scoped, use `--access public` when required.
- After a successful npm publish, create a git tag equal to the package version with no prefix.
- Use `gh release create <version> --generate-notes` to generate release notes from changes since the previous release.
- Push the tag or let `gh release create` create it from the current HEAD, but the final GitHub tag must exactly match the version in `package.json`.

## Examples

- Dry run the next release:
  `Use $release-teamcopilot-npm to dry-run the npm release for this repo.`
- Publish the current version:
  `Use $release-teamcopilot-npm to publish the current package.json version to npm.`
- Publish a beta tag:
  `Use $release-teamcopilot-npm to publish this version to npm with the beta tag.`
- Publish and create the GitHub release:
  `Use $release-teamcopilot-npm to publish this version and then create the matching GitHub tag and release notes.`

## Resources

- `scripts/publish.sh`: deterministic npm release helper for this repo
