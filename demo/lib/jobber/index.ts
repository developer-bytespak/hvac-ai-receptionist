/**
 * Picks the Jobber implementation.
 *
 * Mock unless all three credentials are present, so the demo runs on a clean
 * machine with no accounts. Set JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET and
 * JOBBER_REFRESH_TOKEN to talk to a real Jobber account instead.
 *
 * JOBBER_MODE=mock forces the mock even when credentials exist, which is what
 * you want while rehearsing so a network problem cannot spoil a live demo.
 */

import { MockJobber } from "./mock";
import { LiveJobber } from "./live";
import type { JobberGateway } from "./types";

let gateway: JobberGateway | null = null;

export function jobberConfigured(): boolean {
  return Boolean(
    process.env.JOBBER_CLIENT_ID &&
      process.env.JOBBER_CLIENT_SECRET &&
      process.env.JOBBER_REFRESH_TOKEN,
  );
}

export function jobber(): JobberGateway {
  if (gateway) return gateway;
  const forced = process.env.JOBBER_MODE;
  gateway = forced !== "live" && (forced === "mock" || !jobberConfigured())
    ? new MockJobber()
    : new LiveJobber();
  return gateway;
}

export type { JobberGateway } from "./types";
export * from "./types";
export { decodeSlot, encodeSlot, speakWindow } from "./mock";
