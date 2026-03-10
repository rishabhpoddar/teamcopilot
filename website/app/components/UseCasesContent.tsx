"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import {
  CodeBracketIcon,
  KeyIcon,
  ServerStackIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

const useCases = [
  {
    eyebrow: "01",
    title: "Automate infrastructure management",
    icon: ServerStackIcon,
    iconLabel: "Infrastructure automation",
    summary:
      "Encode the operational workflow once so config changes, rollouts, and validation stop living in one engineer's head.",
    details: [
      "Document access paths, safety checks, and deployment steps inside a reusable skill.",
      "Let the agent read the current state first, then make narrow changes with backups.",
      "Keep the whole change auditable from rollout through smoke tests.",
    ],
    exampleTitle: "Example skill: infrastructure config changes",
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
7. Run beta tests:
   \`service-beta-smoke-tests\`
8. After the change is validated, delete the backup file.

## Guardrails
- Never skip reading the remote file first.
- Never edit the local copy and upload it wholesale.
- If any command fails, inspect the error, adjust the plan, and continue carefully.
- Report exactly what changed and what validation passed.`,
  },
  {
    eyebrow: "02",
    title: "Create API wrappers without sharing secrets",
    icon: KeyIcon,
    iconLabel: "Internal API workflows",
    summary:
      "Wrap internal APIs behind plain-English prompts while keeping auth and endpoint details inside the skill.",
    details: [
      "Define the base URL, authentication, and endpoint behavior once.",
      "Let teammates ask natural-language questions instead of memorizing request formats.",
      "Keep sensitive credentials out of the visible UI while still enabling safe access.",
    ],
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
    icon: CodeBracketIcon,
    iconLabel: "Codebase analysis",
    summary:
      "Turn the repository into something the whole team can query without relying on generic AI answers.",
    details: [
      "Let the agent inspect the codebase directly before it answers.",
      "Return file-level explanations that tie technical behavior back to product behavior.",
      "Reduce interrupt-driven questions for engineers without hiding the source of truth.",
    ],
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
    title: "Let non-technical teammates request safe code changes",
    icon: SparklesIcon,
    iconLabel: "Safe code changes",
    summary:
      "Package your engineering workflow into guardrails so routine product changes no longer require direct repo fluency.",
    details: [
      "Capture branch, testing, and review expectations inside the skill.",
      "Use the agent for small, well-scoped code changes that follow existing patterns.",
      "Give non-technical teammates a safe path to request implementation work directly.",
    ],
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

function UseCaseCard({
  eyebrow,
  title,
  icon: Icon,
  iconLabel,
  summary,
  details,
  exampleTitle,
  skill,
}: {
  eyebrow: string;
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconLabel: string;
  summary: string;
  details: string[];
  exampleTitle: string;
  skill: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewLines = skill.split("\n").slice(0, 7).join("\n");

  return (
    <article className="group relative overflow-hidden rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-3.5 shadow-[0_30px_90px_rgba(0,0,0,0.4)] sm:rounded-[30px] sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_28%)] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div>
          <div className="flex items-center gap-3">
            <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium tracking-[0.28em] text-gray-400 uppercase">
              {eyebrow}
            </span>
            <div
              aria-label={iconLabel}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-cyan-400/12 to-emerald-400/10 text-cyan-100 shadow-[0_10px_35px_rgba(8,145,178,0.15)]"
            >
              <Icon className="h-6 w-6" />
            </div>
          </div>
          <h2 className="mt-3 max-w-xl text-xl font-semibold tracking-tight text-white sm:mt-6 sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-300 sm:text-base sm:leading-8">
            {summary}
          </p>

          <div className="mt-5 hidden gap-2.5 sm:mt-8 sm:grid">
            {details.map((detail) => (
              <div
                key={detail}
                className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-black/20 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3"
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" />
                <p className="text-sm leading-7 text-gray-300 sm:leading-6">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className={`cursor-pointer rounded-[18px] border bg-black/45 p-3 backdrop-blur-sm transition-colors sm:rounded-[24px] sm:p-5 ${isExpanded ? "border-cyan-300/30 bg-white/[0.05]" : "border-white/10 hover:border-white/20"
            }`}
        >
          <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-gray-500">
                Example Skill
              </p>
              <h4 className="mt-2 max-w-md text-base font-semibold leading-tight text-white sm:text-2xl">
                {exampleTitle}
              </h4>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${isExpanded
                ? "border-cyan-300/20 text-white"
                : "border-white/10 text-gray-300"
                }`}
            >
              {isExpanded ? "Collapse" : "Expand"}
            </span>
          </div>

          {!isExpanded && (
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] p-2.5 sm:mt-4 sm:rounded-2xl sm:p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-200/70">
                Skill Preview
              </p>
              <pre className="mt-2 overflow-hidden text-[11px] leading-5 text-gray-400 whitespace-pre-wrap break-words sm:mt-3 sm:text-sm sm:leading-7">
                <code>{previewLines}</code>
              </pre>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="relative mt-5 sm:mt-8">
          <pre className="rounded-xl border border-white/10 bg-[#050505] p-3 text-xs leading-6 text-gray-300 whitespace-pre-wrap break-words sm:rounded-2xl sm:p-4 sm:text-sm sm:leading-7">
            <code>{skill}</code>
          </pre>
        </div>
      )}
    </article>
  );
}

export default function UseCasesContent() {
  return (
    <main className="min-h-screen overflow-hidden bg-blue-600 pt-28 text-white">
      <section className="relative px-3 pb-8 sm:px-6 sm:pb-14">
        <div className="pointer-events-none absolute inset-x-0 -top-20 bottom-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.10),transparent_22%),radial-gradient(circle_at_20%_30%,rgba(191,219,254,0.20),transparent_24%),radial-gradient(circle_at_80%_20%,rgba(125,211,252,0.18),transparent_22%),linear-gradient(180deg,rgba(37,99,235,0)_0%,rgba(29,78,216,0.20)_18%,rgba(30,64,175,0.14)_58%,rgba(37,99,235,0)_100%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-4xl">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm sm:rounded-[28px] sm:p-7">
              <p className="text-xs font-medium uppercase tracking-[0.34em] text-gray-500 sm:text-sm">
                Use Cases
              </p>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:mt-4 sm:text-4xl lg:text-6xl">
                Example use cases of TeamCopilot
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-400 sm:mt-6 sm:text-lg sm:leading-8">
                Automate infrastructure management, wrap internal APIs, answer codebase questions, and handle safe code changes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-3 pb-18 sm:px-6 sm:pb-24">
        <div className="mx-auto grid max-w-6xl gap-6">
          {useCases.map((useCase) => (
            <UseCaseCard
              key={useCase.title}
              eyebrow={useCase.eyebrow}
              title={useCase.title}
              icon={useCase.icon}
              iconLabel={useCase.iconLabel}
              summary={useCase.summary}
              details={useCase.details}
              exampleTitle={useCase.exampleTitle}
              skill={useCase.skill}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
