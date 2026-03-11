import { NextResponse } from "next/server";

type ConsultationRequestPayload = {
  fullName: string;
  workEmail: string;
  company: string;
  teamSize: string;
  website: string;
  goals: string;
};

function assertValidLeadPayload(payload: ConsultationRequestPayload) {
  if (!payload.fullName.trim()) {
    throw new Error("Full name is required.");
  }

  if (!payload.workEmail.trim()) {
    throw new Error("Work email is required.");
  }

  if (!payload.company.trim()) {
    throw new Error("Company is required.");
  }

  if (!payload.goals.trim()) {
    throw new Error("Please describe the workflow you want to automate.");
  }
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ConsultationRequestPayload;

  try {
    assertValidLeadPayload(payload);

    return NextResponse.json({
      ok: true,
      mocked: true,
      upstream: "https://api.teamcopilot.ai/v1/ai-automation-consulting",
      message: "Consultation request received. We will follow up with next steps.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
