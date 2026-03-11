import type { Metadata } from "next";

import LeadCaptureForm from "../components/LeadCaptureForm";
import Navbar from "../components/Navbar";
import { getSiteUrl } from "../site-config";

const demoBenefits = [
  "See a live demo of TeamCopilot for your use case",
  "Ask technical questions about setup, security or just how the product works",
  "Happy to chat about AI agents in general",
];

export const metadata: Metadata = {
  title: "Book an Demo | TeamCopilot",
  description:
    "Book a TeamCopilot demo to see how shared AI agents, approval workflows, and self-hosted automation work for your team.",
  alternates: {
    canonical: `${getSiteUrl()}/book-demo`,
  },
  keywords: [
    "ai agent platform demo",
    "book ai automation demo",
    "ai workflow demo",
    "teamcopilot demo",
    "self hosted ai agent demo",
  ],
};

export default function BookDemoPage() {
  return (
    <>
      <Navbar currentPage="book-demo" />
      <main className="relative min-h-screen overflow-hidden bg-black pt-28 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.15),transparent_24%),linear-gradient(180deg,#050505_0%,#000000_100%)]" />

        <section className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-1 text-xs font-medium tracking-[0.28em] text-cyan-100 uppercase">
              Get on a call with us
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Book a demo for your team
            </h1>

            <div className="mt-10 space-y-4">
              {demoBenefits.map((benefit) => (
                <div
                  key={benefit}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-gray-200"
                >
                  {benefit}
                </div>
              ))}
            </div>

            <p className="mt-8 text-sm leading-7 text-gray-400">
              We can do demos on weekends as well
            </p>
          </div>

          <LeadCaptureForm formType="demo" submitLabel="Request demo" />
        </section>
      </main>
    </>
  );
}
