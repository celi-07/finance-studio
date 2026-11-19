import { handleDemoAssistant } from "@/lib/ai-demo-server";

export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) { return handleDemoAssistant(request); }
