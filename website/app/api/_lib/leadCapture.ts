import { NextResponse } from "next/server";

export type LeadFormType = "demo" | "consultation";
const FORMSPREE_ENDPOINT = "https://formspree.io/f/mojkdeby";

type LeadCapturePayload = {
  fullName: string;
  workEmail: string;
  company: string;
  teamSize: string;
  website: string;
  goals: string;
  formType: LeadFormType;
};

function isLeadFormType(value: unknown): value is LeadFormType {
  return value === "demo" || value === "consultation";
}

function assertValidLeadPayload(payload: LeadCapturePayload) {
  if (!payload.fullName.trim()) {
    throw new Error("Full name is required.");
  }

  if (!payload.workEmail.trim()) {
    throw new Error("Work email is required.");
  }

  if (!payload.company.trim()) {
    throw new Error("Company is required.");
  }

  if (!payload.teamSize.trim()) {
    throw new Error("Team size is required.");
  }

  if (!payload.website.trim()) {
    throw new Error("Website is required.");
  }

  if (!payload.goals.trim()) {
    throw new Error("Please share more details about your request.");
  }
}

export async function handleLeadCapture(request: Request, fallbackFormType?: LeadFormType) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const formType = isLeadFormType(body.formType) ? body.formType : fallbackFormType;

    if (!formType) {
      throw new Error("Form type is required.");
    }

    const payload: LeadCapturePayload = {
      fullName: String(body.fullName ?? ""),
      workEmail: String(body.workEmail ?? ""),
      company: String(body.company ?? ""),
      teamSize: String(body.teamSize ?? ""),
      website: String(body.website ?? ""),
      goals: String(body.goals ?? ""),
      formType,
    };

    assertValidLeadPayload(payload);

    const response = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as { errors?: Array<{ message?: string }> };

    if (!response.ok) {
      throw new Error(result.errors?.[0]?.message ?? "Something went wrong. Please try again.");
    }

    return NextResponse.json({
      ok: true,
      upstream: FORMSPREE_ENDPOINT,
      message: "Thanks. We will get back to you shortly.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
