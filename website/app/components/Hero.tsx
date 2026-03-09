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
  },
  {
    title: "Skill & tool permissions",
    description: "Control who can use which skills and tools through the agent. Example: allow only certain people in the team to use a skill for making server config changes.",
  },
  {
    title: "Approval workflow",
    description: "Anyone can create tools/skills, but engineers in the team must approve them before the agent can even see them.",
  },
  {
    title: "Fully auditable",
    description: "Chat sessions can't be deleted by users and are stored on your server.",
  },
  {
    title: "Use it anywhere",
    description: "Web UI lets you talk to the agent even when you're away from your work machine.",
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
            className="w-full h-full object-cover"
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 pt-24">
          {/* Star on GitHub Button */}
          <a
            href="https://github.com/rishabhpoddar/teamcopilot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-6 py-3 mb-8 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/15 transition-all animate-fade-in-up"
            style={{ animationDelay: "0.1s" }}
          >
            <GitHubIcon className="w-6 h-6 text-white" />
            <span className="text-white font-medium">Star on GitHub</span>
            <StarIcon className="w-5 h-5 text-white" />
          </a>

          {/* Headline */}
          <h1
            className="text-5xl sm:text-6xl md:text-7xl lg:text-[80px] font-bold text-white text-center tracking-tight leading-[1.1] max-w-5xl animate-fade-in-up"
            style={{ animationDelay: "0.2s" }}
          >
            A Shared AI Agent for Teams
          </h1>

          {/* Subtext */}
          <p
            className="mt-6 text-lg sm:text-xl text-gray-400 text-center max-w-2xl leading-relaxed animate-fade-in-up"
            style={{ animationDelay: "0.3s" }}
          >
            Think Claude Code, but shared across your entire team and running on
            your cloud. Configure once, the whole team can use it.
          </p>

          {/* Feature Tags */}
          <div
            className="flex flex-wrap items-center justify-center gap-3 mt-8 animate-fade-in-up"
            style={{ animationDelay: "0.4s" }}
          >
            {featureTags.map((feature) => (
              <span
                key={feature}
                className="px-4 py-2 text-sm text-gray-300 rounded-full bg-white/5 border border-white/10"
              >
                {feature}
              </span>
            ))}
          </div>

          {/* CTA Button */}
          <div
            className="flex flex-wrap items-center justify-center gap-4 mt-10 animate-fade-in-up"
            style={{ animationDelay: "0.5s" }}
          >
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

      {/* Features Section */}
      <section id="features" className="relative z-10 bg-black py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-white text-center mb-16">
            Why TeamCopilot?
          </h2>

          <div className="space-y-12">
            {detailedFeatures.map((feature) => (
              <div
                key={feature.title}
                className="border-l-2 border-white/20 pl-6 hover:border-white/50 transition-colors"
              >
                <h3 className="text-xl font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
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
