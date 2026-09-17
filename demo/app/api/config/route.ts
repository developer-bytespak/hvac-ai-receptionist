/**
 * Public demo configuration. The Retell public key is meant to be visible in
 * the browser; the API key and the Jobber secret never leave the server.
 */
import { NextResponse } from "next/server";
import { COMPANY, SERVICE_AREA, TECHNICIANS } from "@/lib/config";
import { databaseMode, databaseWarning } from "@/lib/db";
import { jobber, jobberConfigured } from "@/lib/jobber";
import { smsConfigured, smsMode } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    company: COMPANY,
    technicians: TECHNICIANS.map((t) => ({ id: t.id, firstName: t.firstName, name: t.name, tone: t.tone })),
    serviceArea: SERVICE_AREA,
    retell: {
      publicKey: process.env.NEXT_PUBLIC_RETELL_PUBLIC_KEY ?? "",
      agentId: process.env.NEXT_PUBLIC_RETELL_AGENT_ID ?? "",
      phoneNumber: process.env.NEXT_PUBLIC_DEMO_PHONE_NUMBER ?? "",
      configured: Boolean(
        process.env.NEXT_PUBLIC_RETELL_PUBLIC_KEY && process.env.NEXT_PUBLIC_RETELL_AGENT_ID,
      ),
    },
    integrations: {
      database: { mode: databaseMode(), warning: databaseWarning() },
      jobber: { mode: jobber().mode, credentialsPresent: jobberConfigured() },
      sms: { mode: smsMode(), credentialsPresent: smsConfigured() },
    },
  });
}
