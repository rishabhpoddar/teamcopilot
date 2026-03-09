import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12 sm:px-10 sm:py-16">
        <div className="mb-8 flex items-center gap-4 border-b border-current/25 pb-4">
          <Image
            src="/logo.svg"
            alt="TeamCopilot logo"
            width={48}
            height={48}
            priority
          />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            TeamCopilot
          </h1>
        </div>

        <section className="rounded-xl border border-current/20 p-6 sm:p-8">
          <p className="text-lg leading-8 sm:text-xl">
            Introducing a new open-source tool called TeamCopilot: a coding
            agent for teams (
            <a
              href="https://github.com/rishabhpoddar/teamcopilot"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#646cff] hover:underline"
            >
              https://github.com/rishabhpoddar/teamcopilot
            </a>
            ).
          </p>

          <p className="mt-6 text-base leading-7 sm:text-lg">
            Think Claude Code, but shared across your entire team and running
            on your cloud. A few key differences compared to other AI agents:
          </p>

          <ul className="mt-6 list-disc space-y-4 pl-6 text-base leading-7 sm:text-lg">
            <li>
              Multi-user environment - everyone uses the same agent setup.
              Configure once, the whole team can use it.
            </li>
            <li>
              Skill and tool permissions - control who can use which skills and
              tools through the agent. Example: allow only certain people in
              the team to use a skill for making server config changes.
            </li>
            <li>
              Approval workflow - anyone can create tools/skills, but engineers
              in the team must approve them before the agent can even see them.
            </li>
            <li>
              Fully auditable - chat sessions can&apos;t be deleted by users and are
              stored on your server.
            </li>
            <li>
              Use it anywhere - web UI lets you talk to the agent even when
              you&apos;re away from your work machine.
            </li>
          </ul>

          <p className="mt-6 text-base leading-7 sm:text-lg">
            The aim here is create a safe and user friendly environment for all
            team members to leverage AI agents.
          </p>
          <p className="mt-4 text-base leading-7 sm:text-lg">
            It works with Claude models using API keys or subscriptions.
          </p>
        </section>
      </main>
    </div>
  );
}
