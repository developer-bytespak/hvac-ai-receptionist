/**
 * The endpoint Retell calls when the agent uses a tool. This is the pipeline
 * entry point: verify the signature first, record that verification so the
 * client can watch it happen, then dispatch.
 */

import { NextRequest, NextResponse } from "next/server";
import { databaseWarning } from "@/lib/db";
import { isAfterHours } from "@/lib/config";
import { logPipeline, touchCall } from "@/lib/ops";
import { signatureRequired, verifyRetellSignature, type ToolRequest } from "@/lib/retell";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return await handle(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Retell reads this aloud in the worst case, so keep it short and calm.
    return NextResponse.json(
      { status: "error", say: "I could not reach the schedule just now", detail: message, hint: databaseWarning() },
      { status: 200 },
    );
  }
}

async function handle(request: NextRequest) {
  const startedAt = Date.now();
  const rawBody = await request.text();

  let payload: ToolRequest;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const callId = payload?.call?.call_id;
  if (!callId || !payload?.name) {
    return NextResponse.json({ error: "expected name and call.call_id" }, { status: 400 });
  }

  const check = verifyRetellSignature(
    rawBody,
    request.headers.get("x-retell-signature"),
    process.env.RETELL_API_KEY,
  );

  // The after hours flag has to be set on the row that is created first, or
  // the "calls answered after hours" figure on the revenue panel stays at zero.
  await touchCall(callId, {
    channel: payload.call.from_number ? "phone" : "web",
    fromNumber: payload.call.from_number,
    afterHours: isAfterHours(),
  });

  if (!check.ok) {
    if (signatureRequired()) {
      await logPipeline(callId, "call_answered", "error", check.reason);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    await logPipeline(callId, "call_answered", "warn", `unsigned, allowed by demo setting`);
  } else {
    await logPipeline(callId, "call_answered", "ok", `verified, ${check.ageMs} ms old`, Date.now() - startedAt);
  }

  await logPipeline(callId, "intent_classified", "ok", payload.name.replace(/_/g, " "));

  const result = await runTool(payload);
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ ok: true, signature_required: signatureRequired() });
}
