/** Retell's call lifecycle webhook. Closes the call and records the outcome. */

import { NextRequest, NextResponse } from "next/server";
import { closeCall, logCallEvent, logPipeline, touchCall } from "@/lib/ops";
import { signatureRequired, verifyRetellSignature } from "@/lib/retell";
import { isAfterHours } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: {
    event: string;
    call: {
      call_id: string;
      from_number?: string;
      disconnection_reason?: string;
      call_analysis?: {
        call_summary?: string;
        user_sentiment?: string;
        custom_analysis_data?: Record<string, unknown>;
      };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const check = verifyRetellSignature(rawBody, request.headers.get("x-retell-signature"), process.env.RETELL_API_KEY);
  if (!check.ok && signatureRequired()) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const call = payload.call;
  if (!call?.call_id) return NextResponse.json({ error: "missing call_id" }, { status: 400 });

  await touchCall(call.call_id, {
    channel: call.from_number ? "phone" : "web",
    fromNumber: call.from_number,
    afterHours: isAfterHours(),
  });

  if (payload.event === "call_started") {
    await logCallEvent({ callId: call.call_id, action: "call_started", outcome: "ok" });
    return NextResponse.json({ received: true });
  }

  if (payload.event === "call_ended") {
    await logCallEvent({
      callId: call.call_id,
      action: "call_ended",
      outcome: call.disconnection_reason ?? "ok",
    });
    await closeCall(call.call_id, call.disconnection_reason ?? "ended");
    return NextResponse.json({ received: true });
  }

  if (payload.event === "call_analyzed") {
    const analysis = call.call_analysis ?? {};
    const custom = analysis.custom_analysis_data ?? {};
    const outcome = String(custom.outcome ?? "completed");

    await closeCall(call.call_id, outcome, analysis.call_summary);
    await logCallEvent({
      callId: call.call_id,
      action: "call_analyzed",
      outcome,
      urgency: custom.urgency ? String(custom.urgency) : null,
      detail: { sentiment: analysis.user_sentiment ?? null },
    });
    await logPipeline(call.call_id, "caller_confirmed", "ok", `call closed as ${outcome}`);
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true, ignored: payload.event });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "retell call lifecycle webhook" });
}
