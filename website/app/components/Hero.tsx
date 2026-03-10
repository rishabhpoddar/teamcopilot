import Link from "next/link";
import Image from "next/image";

import VideoPlayer from "./VideoPlayer";

const featureTags = [
  "Multi-user environment",
  "Custom Skills + Tools",
  "User permissions for skills and tools",
  "Run on your own cloud",
  "Web UI access",
  "Open source"
];

const detailedFeatures = [
  {
    title: "Multi-user environment",
    description: "Everyone uses the same agent setup. Configure once, the whole team can use it.",
    accent: "01",
  },
  {
    title: "Skill & tool permissions",
    description: "Control who can use which skills and tools through the agent. Example: allow only certain people in the team to use a skill for making server config changes.",
    accent: "02",
  },
  {
    title: "Approval workflow",
    description: "Anyone can create tools/skills, but engineers in the team must approve them before the agent can even see them.",
    accent: "03",
  },
  {
    title: "Fully private and secure",
    description: "You can self-host TeamCopilot. This means all your chats, data and secrets stay on your own cloud.",
    accent: "04",
  },
  {
    title: "Use it anywhere",
    description: "Web UI lets you talk to the agent even when you're away from your work machine.",
    accent: "05",
  },
  {
    title: "Use any AI model",
    description: "Use any AI model from OpenAI or Anthropic.",
    accent: "06",
  },
];

export default function Hero() {
  return (
    <div className="bg-black">
      <section className="relative min-h-screen overflow-hidden">
        {/* Background Video */}
        <div className="absolute bottom-[35vh] left-0 right-0 h-[80vh] z-0">
          <VideoPlayer
            src="/hero-video.mp4"
            className="w-full h-full object-cover opacity-80 [filter:hue-rotate(12deg)_saturate(1.15)_brightness(0.72)]"
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 pt-24 pb-12 sm:pb-16">
          {/* Star on GitHub Button */}
          <a
            href="https://github.com/rishabhpoddar/teamcopilot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-6 py-3 mb-8 rounded-full border border-blue-300/20 bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(255,255,255,0.08))] backdrop-blur-md hover:bg-[linear-gradient(135deg,rgba(59,130,246,0.24),rgba(255,255,255,0.12))] transition-all"
          >
            <GitHubIcon className="w-6 h-6 text-white" />
            <span className="text-white font-medium">Star on GitHub</span>
            <StarIcon className="w-5 h-5 text-yellow-300" />
          </a>

          {/* Headline */}
          <h1
            className="text-5xl sm:text-6xl md:text-7xl lg:text-[80px] font-bold text-white text-center tracking-tight leading-[1.1] max-w-5xl"
          >
            A Shared AI Agent for Teams
          </h1>

          {/* Subtext */}
          <p
            className="mt-6 text-lg sm:text-xl text-gray-400 text-center max-w-2xl leading-relaxed"
          >
            Think Claude Code, but shared across your entire team and running on
            your cloud. Configure once, the whole team can use it.
          </p>

          {/* Feature Tags */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            {featureTags.map((feature) => (
              <span
                key={feature}
                className="px-4 py-2 text-sm text-gray-300 rounded-full border border-blue-300/10 bg-[linear-gradient(135deg,rgba(59,130,246,0.10),rgba(255,255,255,0.04))]"
              >
                {feature}
              </span>
            ))}
          </div>

          {/* CTA Button */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-10">
            <Link
              href="/use-cases"
              className="px-8 py-3.5 text-base font-medium rounded-full border border-blue-300/30 bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(255,255,255,0.06))] text-white transition-all hover:border-blue-200/50 hover:bg-[linear-gradient(135deg,rgba(59,130,246,0.26),rgba(255,255,255,0.10))] hover:scale-[1.02] active:scale-[0.98]"
            >
              See example use cases
            </Link>
            <a
              href="https://github.com/rishabhpoddar/teamcopilot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3.5 text-base font-medium rounded-full bg-black text-white border-2 border-white transition-all hover:bg-white hover:text-black hover:scale-[1.02] active:scale-[0.98]"
            >
              View on GitHub
            </a>
          </div>

        </div>
      </section>

      <section id="dashboard" className="relative z-10 bg-black px-4 pt-10 pb-12 sm:px-6 sm:pt-0">
        <div className="mx-auto max-w-7xl">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5 shadow-[0_40px_120px_rgba(0,0,0,0.45)] sm:rounded-[32px] sm:p-8 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.16),transparent_28%)]" />

            <div className="relative grid items-center gap-8 xl:grid-cols-[0.9fr_1.4fr] xl:gap-10">
              <div className="mx-auto flex min-w-0 max-w-2xl flex-col items-center text-center xl:mx-0 xl:max-w-xl xl:items-start xl:text-left">
                <p className="text-xs font-medium uppercase tracking-[0.28em] text-gray-500 sm:text-sm">
                  Dashboard View
                </p>
                <h2 className="mt-4 max-w-[12ch] text-[2.25rem] leading-[1.05] font-bold tracking-tight text-white sm:max-w-none sm:text-4xl">
                  A web UI to talk to your team&apos;s agent anywhere, anytime.
                </h2>
                <p className="mt-5 text-base leading-7 text-gray-400 sm:text-lg">
                  TeamCopilot gives your team a single interface to chat with the
                  agent, browse approved workflows and skills, and inspect run
                  history without passing around local setup details.
                </p>

                <div className="mt-8 grid w-full max-w-[36rem] gap-4 text-sm text-gray-300 sm:grid-cols-2 xl:max-w-none xl:grid-cols-1">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    Anyone can create custom agent skills and tools. After approval, anyone in your team can use them.
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    Fully self hosted means all your data and secrets stay on your own cloud.
                  </div>
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-[52rem] xl:max-w-[42rem]">
                <div className="overflow-hidden rounded-[24px] border border-white/12 bg-[#0a0a0a] shadow-2xl shadow-black/50 sm:rounded-[28px]">
                  <div className="flex flex-col items-start gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                    </div>
                    <div className="max-w-full rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] leading-relaxed tracking-[0.22em] text-gray-400 uppercase sm:text-[11px]">
                      TeamCopilot Dashboard
                    </div>
                  </div>

                  <div className="relative aspect-[2556/1630]">
                    <Image
                      src="/dashboard.jpeg"
                      alt="TeamCopilot dashboard showing AI chat, sessions list, workflows, skills, and run history"
                      fill
                      priority
                      sizes="(max-width: 640px) 100vw, (max-width: 1280px) 60vw, 900px"
                      className="object-cover object-top"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 overflow-hidden bg-black px-4 py-24 sm:px-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_30%)]" />

        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-medium uppercase tracking-[0.34em] text-gray-500 sm:text-sm">
              Why TeamCopilot
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Built for teams that want one agent setup, not twenty personal ones
            </h2>
            <p className="mt-5 text-base leading-7 text-gray-400 sm:text-lg">
              The product is designed around shared infrastructure, controlled
              rollout, and visibility into how the agent is being used across
              your organization.
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {detailedFeatures.map((feature) => (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05]"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_30%)] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />

                <div className="relative flex h-full flex-col">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] font-medium tracking-[0.28em] text-gray-400 uppercase">
                      {feature.accent}
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full bg-white/70 shadow-[0_0_20px_rgba(255,255,255,0.45)]" />
                  </div>

                  <h3 className="mt-8 text-2xl font-semibold tracking-tight text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-gray-400">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="relative mt-10 overflow-hidden rounded-[32px] border border-cyan-400/15 bg-[linear-gradient(135deg,rgba(8,145,178,0.14),rgba(255,255,255,0.04))] px-6 py-10 shadow-[0_35px_110px_rgba(0,0,0,0.45)] sm:mt-14 sm:px-10 sm:py-12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_24%)]" />

            <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-xs font-medium uppercase tracking-[0.34em] text-cyan-100/80 sm:text-sm">
                  Security
                </p>
                <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Security controls that keep the agent inside your boundaries
                </h2>
                <p className="mt-5 text-base leading-7 text-gray-300 sm:text-lg">
                  TeamCopilot keeps chats on your infrastructure, gates skills and workflows with permissions,
                  redacts secrets before data reaches the frontend, and requires explicit approval before workflow
                  execution.
                </p>
              </div>

              <div className="grid gap-3 text-sm text-gray-200">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  Self-hosted deployment keeps credentials and chat history on your servers.
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  Engineers approve skill and workflow changes before the agent can use them.
                </div>
                <Link
                  href="/security"
                  className="inline-flex items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-400/10 px-6 py-3 text-sm font-medium text-white transition-all hover:border-cyan-200/60 hover:bg-cyan-400/18"
                >
                  Explore security details
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Icons
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.11.793-.26.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
