/** Wipes the demo back to a fresh week. Backs the Reset button. */
import { NextResponse } from "next/server";
import { resetDemo } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await resetDemo();
  return NextResponse.json({ ok: true, reset_at: new Date().toISOString() });
}
