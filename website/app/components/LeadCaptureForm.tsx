"use client";

import { FormEvent, useState } from "react";

declare global {
  interface Window {
    gtag_report_conversion?: (url?: string) => boolean;
  }
}

type LeadCaptureFormProps = {
  formType: "demo" | "consultation";
  submitLabel: string;
};

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const SHARED_LEAD_CAPTURE_ENDPOINT = "/api/lead-capture";

export default function LeadCaptureForm({ formType, submitLabel }: LeadCaptureFormProps) {
  const [submissionState, setSubmissionState] = useState<SubmissionState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionState({ status: "submitting" });
    const form = event.currentTarget;

    const formData = new FormData(form);
    const payload = {
      fullName: String(formData.get("fullName")),
      workEmail: String(formData.get("workEmail")),
      company: String(formData.get("company")),
      teamSize: String(formData.get("teamSize")),
      website: String(formData.get("website")),
      goals: String(formData.get("goals")),
      formType,
    };

    try {
      const response = await fetch(SHARED_LEAD_CAPTURE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { message?: string; errors?: Array<{ message: string }> };

      if (!response.ok) {
        throw new Error(result.errors?.[0]?.message ?? result.message ?? "Something went wrong. Please try again.");
      }

      form.reset();
      window.gtag_report_conversion?.();
      setSubmissionState({
        status: "success",
        message: "Thanks. We will get back to you shortly.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setSubmissionState({ status: "error", message });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.14),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_30%)]" />
      <div className="relative grid gap-5">
        <div>
          <label htmlFor={`${formType}-fullName`} className="text-sm font-medium text-gray-200">
            Full name
          </label>
          <input
            id={`${formType}-fullName`}
            name="fullName"
            required
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label htmlFor={`${formType}-workEmail`} className="text-sm font-medium text-gray-200">
            Email
          </label>
          <input
            id={`${formType}-workEmail`}
            name="workEmail"
            type="email"
            required
            autoComplete="email"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
            placeholder="jane@company.com"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${formType}-company`} className="text-sm font-medium text-gray-200">
              Company
            </label>
            <input
              id={`${formType}-company`}
              name="company"
              required
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
              placeholder="Acme Inc."
            />
          </div>
          <div>
            <label htmlFor={`${formType}-teamSize`} className="text-sm font-medium text-gray-200">
              Team size
            </label>
            <div className="relative mt-2">
              <select
                id={`${formType}-teamSize`}
                name="teamSize"
                required
                defaultValue=""
                className="w-full appearance-none rounded-2xl border border-white/10 bg-black/40 px-4 py-3 pr-12 text-white outline-none transition focus:border-cyan-300/50"
              >
                <option value="" disabled>
                  Select team size
                </option>
                <option value="1-10">1-10</option>
                <option value="11-50">11-50</option>
                <option value="51-200">51-200</option>
                <option value="201-1000">201-1000</option>
                <option value="1000+">1000+</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 7.5 10 12.5l5-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor={`${formType}-website`} className="text-sm font-medium text-gray-200">
            Website
          </label>
          <input
            id={`${formType}-website`}
            name="website"
            type="text"
            required
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
            placeholder="company.com"
          />
        </div>

        <div>
          <label htmlFor={`${formType}-goals`} className="text-sm font-medium text-gray-200">
            {formType === "demo" ? "What do you want to see in the demo?" : "What business process do you want to automate?"}
          </label>
          <textarea
            id={`${formType}-goals`}
            name="goals"
            required
            rows={5}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
            placeholder={
              formType === "demo"
                ? "Examples: internal support agent, SEO workflow, engineering automation, approval controls."
                : "Examples: lead routing, reporting, customer support, proposal generation, internal operations."
            }
          />
        </div>

        <button
          type="submit"
          disabled={submissionState.status === "submitting"}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-200 to-white px-6 py-3 text-sm font-semibold text-black transition hover:shadow-lg hover:shadow-cyan-200/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submissionState.status === "submitting" ? "Submitting..." : submitLabel}
        </button>

        {submissionState.status === "success" ? (
          <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {submissionState.message}
          </p>
        ) : null}

        {submissionState.status === "error" ? (
          <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {submissionState.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
