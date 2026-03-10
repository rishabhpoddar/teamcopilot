import type { Metadata } from "next";
import {
  CheckBadgeIcon,
  EyeIcon,
  KeyIcon,
  LockClosedIcon,
  RectangleStackIcon,
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import Navbar from "../components/Navbar";
import { getSiteUrl } from "../site-config";

const securityPoints = [
  {
    title: "Self-hosted",
    description:
      "All credentials and data stay on your servers, not inside a third-party hosted control plane.",
    icon: LockClosedIcon,
  },
  {
    title: "Permission-based skills and workflow",
    description:
      "Only people who have been granted access to specific skills and workflows can use them.",
    icon: KeyIcon,
  },
  {
    title: "Engineer approval for skill and workflow changes",
    description:
      "Any updates to skills or workflows must be approved by engineers on your team before the agent can use them.",
    icon: CheckBadgeIcon,
  },
  {
    title: "Auditable chat history",
    description:
      "Chat sessions are stored on your servers and users cannot delete them through the UI, which keeps the full record auditable.",
    icon: EyeIcon,
  },
  {
    title: "Secrets stay out of the frontend",
    description:
      "The frontend does not expose secrets or tokens even if the agent uses them during a chat session. Sensitive information sent to the UI is redacted on the server first.",
    icon: ShieldCheckIcon,
  },
  {
    title: "No autonomous workflow execution",
    description:
      "The AI never auto-runs workflows you define. It first asks for permission in the UI and only proceeds if the user approves and has permission to run that workflow.",
    icon: WrenchScrewdriverIcon,
  },
  {
    title: "Deterministic custom workflows",
    description:
      "Define custom workflows for fixed tasks, use the AI agent to help code them, and after approval let others use them in their chat sessions. Because workflows are all code, they are a powerful way to guarantee determinism.",
    icon: RectangleStackIcon,
  },
];

export const metadata: Metadata = {
  title: "Security - TeamCopilot",
  description:
    "See how TeamCopilot handles permissions, approvals, auditability, redaction, and workflow execution controls.",
  alternates: {
    canonical: `${getSiteUrl()}/security`,
  },
};

export default function SecurityPage() {
  return (
    <>
      <Navbar currentPage="security" />
      <main className="relative min-h-screen overflow-hidden bg-black pt-28 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.16),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.12),transparent_22%),linear-gradient(180deg,#050505_0%,#000000_100%)]" />

        <section className="relative mx-auto max-w-7xl px-6 pb-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-1 text-xs font-medium tracking-[0.28em] text-cyan-100 uppercase">
              Security
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Run your AI agent confidently
            </h1>
            <p className="mt-6 text-base leading-8 text-gray-300 sm:text-lg">
              TeamCopilot is designed so your team can adopt AI workflows without giving up control of credentials,
              approvals, audit trails, or execution boundaries.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {securityPoints.map(({ title, description, icon: Icon }) => (
              <article
                key={title}
                className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] backdrop-blur-sm"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.14),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.10),transparent_30%)]" />
                <div className="relative">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">{title}</h2>
                  <p className="mt-3 text-sm leading-7 text-gray-300 sm:text-base">{description}</p>
                </div>
              </article>
            ))}
          </div>

          <section className="relative mt-8 overflow-hidden rounded-[32px] border border-emerald-400/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.03))] p-8 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_28%)]" />
            <div className="relative max-w-4xl">
              <p className="text-xs font-medium tracking-[0.28em] text-emerald-200 uppercase">Extensible guardrails</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">Add your own enforcement hooks</h2>
              <p className="mt-4 text-base leading-8 text-gray-200">
                You can define custom hooks that deny specific agent actions before they happen. For example, if you
                never want the AI to use SSH, you can add a hook that detects <code className="rounded bg-black/40 px-2 py-1 text-sm text-emerald-100">ssh</code> in bash
                commands and rejects it. You can also define your own AI instructions that get injected into each chat session in{" "}
                <code className="rounded bg-black/40 px-2 py-1 text-sm text-emerald-100">USER_INSTRUCTIONS.md</code>{" "}
                inside your workspace.
              </p>
            </div>
          </section>
        </section>
      </main>
    </>
  );
}
