# Secret Proxy Plan

## Goal

Stop exposing plaintext secret values to the agent. The agent should only see and use proxy references such as `{{SECRET:OPENAI_API_KEY}}`. When the agent uses those proxies in bash tool calls, TeamCopilot should substitute the real values at execution time inside a trusted runtime hook.

## Desired End State

- The agent never receives raw secret values in prompts, tool outputs, or chat-visible payloads.
- Skills keep placeholders like `{{SECRET:KEY}}` in `SKILL.md`.
- The first chat preamble only includes secret key names and usage instructions, never values.
- `getSkillContent` returns unresolved skill content and metadata about required secret keys, but not a plaintext `secretMap`.
- Bash tool calls may contain `{{SECRET:KEY}}` placeholders.
- Before the bash command is executed, a trusted hook resolves placeholders to real values for the current user and substitutes them at runtime.
- Redaction continues to preserve placeholders while masking real resolved values in logs or frontend-visible content.

## Non-Goals For This Phase

- Do not redesign OAuth/account-connection support.
- Do not add provider-specific secret-aware tools yet.
- Do not change workflow runtime behavior unless needed for consistency. Workflows already get secrets server-side through env injection and are not the main leakage path here.

## Core Design

### Canonical Secret Reference Format

Use `{{SECRET:KEY}}` as the only secret proxy format exposed to the agent.

Rules:
- `KEY` must be normalized to uppercase underscore format.
- The placeholder string is stable and can safely appear in:
  - skill content
  - chat preambles
  - bash command text
  - generated workflow/skill files

### Agent-Facing Contract

The agent should:
- reuse existing secret keys when possible
- only refer to secrets using `{{SECRET:KEY}}`
- never ask for raw values in chat
- tell the user to add missing keys in Profile Secrets when needed

The agent should not:
- receive plaintext values
- print guessed or fake secret values into files
- convert placeholders into raw literals itself

### Runtime Resolution Model

At bash execution time:
1. inspect the outgoing bash command text
2. extract all `{{SECRET:KEY}}` placeholders
3. resolve those keys for the current user using existing secret precedence:
   - user secret first
   - then global secret
4. fail the tool call before execution if any referenced key is missing
5. substitute resolved values into the actual command right before execution
6. ensure any user-visible/logged form still uses placeholder-safe redaction

This gives us a trusted runtime boundary where the model never sees the resolved values, but the executed process still does.

## Implementation Plan

### 1. Remove Plaintext Secret Exposure To The Agent

Update all current places where raw secret values are given to the agent.

Changes:
- remove plaintext `KEY=value` lines from the first chat preamble
- replace them with a key-only inventory, for example:
  - `Available secret keys for this user: OPENAI_API_KEY, STRIPE_API_KEY`
- update `getUserSecrets` so it returns key metadata only, not plaintext values
- update `getSkillContent` so it no longer returns plaintext `secretMap`

New `getSkillContent` contract:
```json
{
  "skill": {
    "slug": "example-skill",
    "path": "SKILL.md",
    "content": "Use {{SECRET:OPENAI_API_KEY}} for authentication.",
    "required_secrets": ["OPENAI_API_KEY"]
  }
}
```

### 2. Teach The Agent To Use Proxies Only

Update workspace instructions in `src/workspace_files/AGENTS.md`.

New instruction set:
- when using secrets in bash commands, pass `{{SECRET:KEY}}`
- do not try to resolve or replace placeholders manually
- when authoring skills, keep placeholders literal in `SKILL.md`
- when authoring workflows, prefer env-based access and declare `required_secrets`
- if a new key is needed, add it to `required_secrets` and tell the user to add it in Profile Secrets

### 3. Add A Reusable Placeholder Resolver

Create a backend utility responsible for:
- extracting `{{SECRET:KEY}}` placeholders from arbitrary text
- normalizing keys
- resolving keys for a user
- returning:
  - substituted command text
  - referenced key list
  - missing key list

Suggested API:
```ts
type SecretProxyResolutionResult = {
  referencedKeys: string[];
  missingKeys: string[];
  substitutedText: string;
};

resolveSecretPlaceholdersForUser(userId: string, text: string): Promise<SecretProxyResolutionResult>
```

This must be reusable across:
- bash command execution
- future structured tools
- possible file/template rendering flows

### 4. Add A Bash Execution Hook

Intercept all bash tool calls before the shell process is launched.

Desired behavior:
- receive original command string from the agent
- run placeholder extraction/resolution
- if no placeholders exist, execute normally
- if placeholders exist and all keys resolve:
  - execute the substituted command
- if placeholders exist and any key is missing:
  - fail with a clear error naming missing keys and instructing the user to add them in Profile Secrets

Important:
- do not mutate the command text stored in agent-visible history if that would reveal secrets
- keep the agent-visible command as the original placeholder-based command whenever possible
- only the trusted runtime should see the substituted command

### 5. Preserve Safe Logging And Redaction

Audit all places that may log or emit command text or tool arguments.

Requirements:
- placeholder text should remain visible as `{{SECRET:KEY}}`
- resolved secret values should be masked if they appear in:
  - tool output
  - SSE events
  - saved messages
  - error payloads

Existing redaction logic should be extended if needed so the bash substitution path cannot leak resolved values back into frontend-visible streams.

### 6. Keep Workflow Runtime As Server-Side Secret Injection

For workflows, keep the current env injection model:
- `workflow.json` declares `required_secrets`
- backend resolves those keys server-side
- child process gets env vars

This is already a proxy-style model from the agent’s perspective as long as we stop telling the agent the plaintext values.

### 7. Tighten Failure Messages

All failure points should tell the agent exactly what to do next without leaking values.

Examples:
- `Missing required secrets: OPENAI_API_KEY, STRIPE_API_KEY. Ask the user to add these keys in TeamCopilot Profile Secrets.`
- `This bash command references missing secrets: GITHUB_TOKEN. Ask the user to add them in TeamCopilot Profile Secrets before retrying.`

## Open Design Choices

### Substitution Style For Bash

Option A: substitute placeholders directly into the final command string
- simplest
- higher leak risk if that exact command text is later logged

Option B: rewrite placeholders to temporary env vars and inject those env vars only at spawn time
- safer
- more implementation work

Preferred direction: start with direct substitution inside a trusted pre-exec hook only if logging is tightly controlled; otherwise prefer env-var rewrite/injection.

### Scope Of Substitution

First phase should target:
- bash command string only

Later phases could extend to:
- structured tool args
- env maps
- file templates

## Testing Plan

### Unit Tests

- placeholder extraction from arbitrary text
- normalization of lowercase placeholder keys
- duplicate placeholder references
- missing-key detection
- substitution of multiple placeholders in one command
- placeholders embedded in quotes
- placeholders embedded in URLs/headers

### Integration Tests

- first chat preamble contains key names only, not values
- `getUserSecrets` returns keys only
- `getSkillContent` returns placeholder-based content without plaintext secrets
- bash command with `{{SECRET:KEY}}` executes successfully when the key exists
- bash command with missing `{{SECRET:KEY}}` fails before execution with a clear error
- frontend/SSE/log output does not reveal resolved values after substitution

### Regression Tests

- workflows still receive env vars correctly
- redaction still preserves placeholder strings
- missing-secret guidance still points users to Profile Secrets

## Success Criteria

- No agent-facing API or prompt includes plaintext secret values.
- Bash commands can still use secrets successfully via `{{SECRET:KEY}}`.
- Missing secrets fail clearly before execution.
- Real secret values never appear in frontend-visible chat payloads or tool metadata.
