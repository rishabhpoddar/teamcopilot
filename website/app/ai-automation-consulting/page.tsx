import type { Metadata } from "next";
import Link from "next/link";

import LeadCaptureForm from "../components/LeadCaptureForm";
import Navbar from "../components/Navbar";
import { getSiteUrl } from "../site-config";

const consultingOutcomes = [
  "Identify repeatable business processes that are good candidates for AI agent automation.",
  "Design operational workflows that combine deterministic steps with agent assistance.",
  "Understand how you can save time and costs using AI agents."
];

export const metadata: Metadata = {
  title: "AI Automation Consulting for Businesses | TeamCopilot",
  description:
    "Talk to TeamCopilot about AI automation for your business operations.",
  alternates: {
    canonical: `${getSiteUrl()}/ai-automation-consulting`,
  },
  keywords: [
    "ai automation consulting",
    "ai agents for business automation",
    "business automation consulting ai",
    "ai agent consulting",
    "business workflow automation consulting",
  ],
};

export default function AutomationConsultingPage() {
  return (
    <>
      <Navbar currentPage="ai-automation-consulting" />
      <main className="relative min-h-screen overflow-hidden bg-black pt-28 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_75%_18%,rgba(14,165,233,0.14),transparent_25%),linear-gradient(180deg,#040404_0%,#000000_100%)]" />

        <section className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 lg:grid-cols-[1.02fr_0.98fr] lg:items-start">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-1 text-xs font-medium tracking-[0.28em] text-emerald-100 uppercase">
              Get on a call with us
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              AI automation consulting for your business
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-gray-300 sm:text-lg">
              Get on a call with an expert to discuss AI agents, models, fine tuning, pricing and safety.
            </p>

            <div className="mt-10 grid gap-4">
              {consultingOutcomes.map((outcome) => (
                <div
                  key={outcome}
                  className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm leading-7 text-gray-200 shadow-[0_24px_70px_rgba(0,0,0,0.35)]"
                >
                  {outcome}
                </div>
              ))}
            </div>

            <section className="relative mt-8 overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(255,255,255,0.04))] p-7 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_26%)]" />
              <div className="relative">
                <p className="text-xs font-medium tracking-[0.28em] text-gray-400 uppercase">Consulting scope</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Discuss your pain points with us</h2>
                <p className="mt-4 text-sm leading-7 text-gray-300 sm:text-base">
                  We will understand them and suggest how AI agents can help you solve them
                </p>
              </div>
            </section>
          </div>

          <LeadCaptureForm formType="consultation" submitLabel="Request consultation" />
        </section>
      </main>
    </>
  );
}
