/**
 * Outbound texts.
 *
 * Twilio is not connected yet, so every message is written to the database
 * with status queued and rendered on the phone mock up in the demo. The
 * conversation, the pipeline and the panel all behave exactly as they will
 * once Twilio is live, which means adding Twilio changes one function and
 * nothing else.
 *
 * To go live set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.
 */

import { q } from "./db";

export type MessageTarget = "caller" | "technician";

export type QueuedMessage = {
  id: number;
  to: string;
  label: MessageTarget;
  body: string;
  status: "queued" | "sent" | "failed";
  provider: "preview" | "twilio";
};

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

export function smsMode(): "preview" | "twilio" {
  return smsConfigured() ? "twilio" : "preview";
}

async function sendViaTwilio(to: string, body: string): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_FROM_NUMBER as string;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );

  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(json.message || `Twilio returned ${res.status}`);
  return { sid: json.sid ?? "" };
}

/**
 * Queues a message, and sends it when Twilio is configured. Never throws into
 * the call: a text that fails must not take down the booking that earned it.
 */
export async function sendMessage(args: {
  callId?: string;
  to: string;
  label: MessageTarget;
  body: string;
}): Promise<QueuedMessage> {
  const provider = smsMode();

  const rows = await q<{ id: number }>(
    `insert into outbound_messages (call_id, to_number, to_label, body, provider, status)
     values ($1,$2,$3,$4,$5,'queued') returning id`,
    [args.callId ?? null, args.to, args.label, args.body, provider],
  );
  const id = rows[0]?.id ?? 0;

  if (provider === "twilio") {
    try {
      const { sid } = await sendViaTwilio(args.to, args.body);
      await q(`update outbound_messages set status = 'sent', provider_id = $2 where id = $1`, [id, sid]);
      return { id, to: args.to, label: args.label, body: args.body, status: "sent", provider };
    } catch (err) {
      await q(`update outbound_messages set status = 'failed', error = $2 where id = $1`, [
        id,
        err instanceof Error ? err.message : "unknown error",
      ]);
      return { id, to: args.to, label: args.label, body: args.body, status: "failed", provider };
    }
  }

  return { id, to: args.to, label: args.label, body: args.body, status: "queued", provider };
}
