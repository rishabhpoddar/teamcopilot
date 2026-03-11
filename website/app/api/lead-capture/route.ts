import { handleLeadCapture } from "../_lib/leadCapture";

export async function POST(request: Request) {
  return handleLeadCapture(request);
}
