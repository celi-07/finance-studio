import { handleAssistant } from "@/lib/ai-server";

export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) { return handleAssistant(request); }
