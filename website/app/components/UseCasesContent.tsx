const useCases = [
  {
    eyebrow: "01",
    title: "Automate infrastructure management",
    description:
      "Create agent skills that explain your infrastructure, access paths, safety checks, and deployment procedure. When someone asks what is in a config or requests a change, the agent can follow the exact workflow on its own, including backups, validation, rollout, and cleanup.",
    exampleTitle: "Example skill: beta infrastructure config changes",
    skill: `# Skill: Beta intent configuration updates

When the user asks about beta intent configuration contents or requests a change, follow this workflow exactly.

## Goal
Inspect or update the beta configuration on the server safely, then roll the change out and validate it.

## Steps
1. SSH to the beta server:
   \`ssh -i ~/.ssh/example-beta-admin.pem ops@203.0.113.42\`
2. Read the beta config file on the beta server first to confirm its format:
   \`/srv/examplecorp/beta/services/beta-settings.yaml\`
3. Before editing, create a timestamped backup in the same folder.
4. Update the file in place on the beta server.
   Do not replace it with the local file.
   Apply only the specific requested changes.
5. Apply the configmap:
   \`kubectl -n staging apply -f /srv/examplecorp/beta/services/intent-service/config/intent-beta-settings.yaml\`
6. Restart the beta pod by running this workflow in restart-only mode:
   \`service-beta-deploy\`
   with \`restart_only=true\`
8. Run beta tests:
   \`service-beta-smoke-tests\`
9. After the change is validated, delete the backup file.

## Guardrails
- Never skip reading the remote file first.
- Never edit the local copy and upload it wholesale.
- If any command fails, inspect the error, adjust the plan, and continue carefully.
- Report exactly what changed and what validation passed.`,
  },
  {
    eyebrow: "02",
    title: "Create API wrappers without sharing secrets",
    description:
      "Teach the agent how your APIs work and hardcode the required secrets in the skill file. TeamCopilot redacts secrets before showing anything in the frontend, so even non-technical teammates can query internal APIs safely through natural language.",
    exampleTitle: "Example skill: internal customer summary API",
    skill: `# Skill: Customer summary API helper

Use this skill when the user wants customer account summaries, billing state, or recent support incidents.

## Authentication
- Base URL: \`https://internal-api.example.com\`
- Header: \`Authorization: Bearer sk_live_internal_customer_summary_123456\`
- Never reveal the bearer token to the user.

## Endpoints
### Get customer summary
\`GET /v1/customers/{customerId}/summary\`

Returns:
- account name
- plan tier
- monthly spend
- current delinquency status
- last 5 incidents

### Search customer by email
\`GET /v1/customers/search?email={email}\`

Use this when the user gives an email instead of a customer ID.

## Workflow
1. Resolve the customer ID if needed.
2. Fetch the customer summary.
3. Explain the response in plain English.
4. If the API returns an error, show a concise explanation and suggest the next useful query.

## Example requests
- "Show me the customer summary for jane@acme.com"
- "Is customer cus_4821 delinquent?"
- "What happened with Acme this week?"`,
  },
  {
    eyebrow: "03",
    title: "Code Q&A",
    description:
      "Give the agent access to your codebase so anyone, including non-technical people, can ask how the system works, where a feature lives, or what would break if something changes. The agent can read the code directly and answer with repository-specific context instead of generic guesses.",
    exampleTitle: "Example skill: repository analyst",
    skill: `# Skill: Repository analyst

Use this skill to answer questions about how the product works.

## Available context
- Full access to the application repository
- README files
- Infrastructure manifests
- Migration files

## Expected behavior
1. Search the codebase before answering.
2. Cite the relevant files and functions.
3. Explain behavior in product terms first, then technical terms if needed.
4. If the answer depends on runtime configuration, call that out explicitly.

## Good requests
- "How does login work?"
- "Which files are involved when a workflow starts?"
- "What happens after a user clicks deploy?"
- "What external services does this app depend on?"`,
  },
  {
    eyebrow: "04",
    title: "Enable non-technical people to make code changes",
    description:
      "Once the agent can read your repository and understands your engineering workflow, it can make routine code changes for people who are not comfortable working directly in the codebase. The skill can encode guardrails such as test requirements, branch naming, review expectations, and deployment constraints.",
    exampleTitle: "Example skill: safe repository changes",
    skill: `# Skill: Safe repository changes

Use this skill when a user asks for a product or content change in the codebase.

## Repository workflow
1. Create a branch named \`teamcopilot/<short-task-name>\`.
2. Inspect the existing implementation before editing.
3. Make the smallest viable code change.
4. Run the relevant tests and linters.
5. Summarize changed files, user-visible impact, and any follow-up work.

## Guardrails
- Do not rewrite unrelated code.
- Preserve existing design patterns unless the request requires otherwise.
- If the change affects production behavior, mention risks clearly.
- If tests fail, debug and fix them before handing back the result.

## Good requests
- "Change the landing page headline"
- "Add a new settings toggle"
- "Update the onboarding copy for finance users"
- "Make the approval status easier to find on mobile"`,
  },
];

function SkillExample({
  title,
  skill,
}: {
  title: string;
  skill: string;
}) {
  const previewLines = skill.split("\n").slice(0, 4).join("\n");

  return (
    <details className="group rounded-[24px] border border-white/10 bg-black/40 p-5 open:border-blue-300/30 open:bg-white/[0.04]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-gray-500">
            Example Skill
          </p>
          <h4 className="mt-2 text-2xl font-semibold leading-tight text-white sm:text-[1.75rem]">
            {title}
          </h4>
          <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 group-open:hidden">
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-blue-200/70">
              Skill Preview
            </p>
            <pre className="mt-3 overflow-hidden text-sm leading-7 text-gray-400 whitespace-pre-wrap">
              <code>{previewLines}</code>
            </pre>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs text-gray-300 transition-colors group-open:border-blue-300/20 group-open:text-white">
          Expand
        </span>
      </summary>
      <pre className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-[#050505] p-4 text-sm leading-7 text-gray-300">
        <code>{skill}</code>
      </pre>
    </details>
  );
}

export default function UseCasesContent() {
  return (
    <main className="min-h-screen overflow-hidden bg-black pt-28 text-white">
      <section className="relative px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_28%),radial-gradient(circle_at_20%_30%,rgba(59,130,246,0.18),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.12),transparent_24%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-4xl">
            <p className="text-xs font-medium uppercase tracking-[0.34em] text-gray-500 sm:text-sm">
              Use Cases
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Show people what becomes possible once the agent knows your systems
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-gray-400">
              TeamCopilot is intentionally open-ended. These examples make that concrete:
              you can teach the agent how your infrastructure works, how your APIs
              should be queried, how your codebase is structured, and how repository
              changes should be handled. Then anyone on the team can use that setup
              productively.
            </p>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-24 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-6">
          {useCases.map((useCase) => (
            <article
              key={useCase.title}
              className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.4)] sm:p-8"
            >
              <div className="grid gap-8 lg:grid-cols-[0.95fr_1.15fr]">
                <div>
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium tracking-[0.28em] text-gray-400 uppercase">
                    {useCase.eyebrow}
                  </span>
                  <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">
                    {useCase.title}
                  </h2>
                  <p className="mt-5 text-base leading-8 text-gray-400">
                    {useCase.description}
                  </p>
                </div>

                <SkillExample title={useCase.exampleTitle} skill={useCase.skill} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
