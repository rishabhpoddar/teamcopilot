import { NextResponse } from "next/server";

type DemoRequestPayload = {
  fullName: string;
  workEmail: string;
  company: string;
  teamSize: string;
  website: string;
  goals: string;
};

function assertValidLeadPayload(payload: DemoRequestPayload) {
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
    throw new Error("Please share what you want to see.");
  }
}

export async function POST(request: Request) {
  const payload = (await request.json()) as DemoRequestPayload;

  try {
    assertValidLeadPayload(payload);

    return NextResponse.json({
      ok: true,
      mocked: true,
      upstream: "https://api.teamcopilot.ai/v1/book-demo",
      message: "Demo request received. We will follow up with scheduling options.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
