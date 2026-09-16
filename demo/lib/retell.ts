/**
 * Retell webhook helpers.
 *
 * Signature format, confirmed against Retell's secure-webhook docs:
 *   header:  x-retell-signature
 *   value:   v=<unix ms timestamp>,d=<hex hmac>
 *   digest:  HMAC-SHA256( rawBody + timestamp , RETELL_API_KEY )
 *
 * Retell also publishes a fixed egress IP (100.20.5.228) for allowlisting.
 * We verify the signature rather than the IP because serverless platforms sit
 * behind proxies that rewrite the source address.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const RETELL_EGRESS_IP = "100.20.5.228";

const MAX_SKEW_MS = 5 * 60 * 1000;

export type VerifyResult =
  | { ok: true; ageMs: number }
  | { ok: false; reason: string };

export function verifyRetellSignature(
  rawBody: string,
  header: string | null,
  apiKey: string | undefined,
): VerifyResult {
  if (!apiKey) return { ok: false, reason: "RETELL_API_KEY is not set on the server" };
  if (!header) return { ok: false, reason: "missing x-retell-signature header" };

  const parts = Object.fromEntries(
    header
      .split(",")
      .map((piece) => piece.trim().split("="))
      .filter((pair) => pair.length === 2) as [string, string][],
  );

  const timestamp = parts.v;
  const digest = parts.d;
  if (!timestamp || !digest) return { ok: false, reason: "malformed signature header" };

  const ageMs = Date.now() - Number(timestamp);
  if (!Number.isFinite(ageMs)) return { ok: false, reason: "signature timestamp is not a number" };
  if (Math.abs(ageMs) > MAX_SKEW_MS) return { ok: false, reason: "signature is outside the 5 minute window" };

  const expected = createHmac("sha256", apiKey).update(rawBody + timestamp).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(digest, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature does not match" };
  }

  return { ok: true, ageMs };
}

/**
 * Demo escape hatch. With ALLOW_UNSIGNED_WEBHOOKS=true the pipeline accepts
 * unsigned calls so the flow can be exercised with curl before the Retell
 * agent is wired up. Never enable this outside a demo.
 */
export function signatureRequired(): boolean {
  return process.env.ALLOW_UNSIGNED_WEBHOOKS !== "true";
}

/** Stable pseudonym for a patient id, so logs carry no direct identifier. */
export function patientRef(patientId: string): string {
  const salt = process.env.PATIENT_HASH_SALT || "demo-salt-change-me";
  return createHmac("sha256", salt).update(patientId).digest("hex").slice(0, 16);
}

export function phoneHash(phone: string): string {
  const salt = process.env.PATIENT_HASH_SALT || "demo-salt-change-me";
  return createHmac("sha256", salt).update(phone.replace(/\D/g, "")).digest("hex").slice(0, 16);
}

/** The body Retell POSTs to a custom function endpoint. */
export type ToolRequest = {
  name: string;
  call: {
    call_id: string;
    from_number?: string;
    to_number?: string;
    agent_id?: string;
    retell_llm_dynamic_variables?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  args: Record<string, any>;
};
