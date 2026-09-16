/**
 * Live Jobber client.
 *
 * Implements the same interface as the mock, so switching is a matter of
 * setting JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET and JOBBER_REFRESH_TOKEN.
 *
 * Things this file gets right because Jobber will bite you otherwise:
 *   - The API version header is pinned. Jobber defaults you to the oldest
 *     supported version if you omit it.
 *   - Refresh token rotation is on by default, so the new refresh token is
 *     captured every time. Losing it means re-authorising by hand.
 *   - Mutations return HTTP 200 on failure. The real errors are in userErrors,
 *     so every mutation asks for it and every call checks it.
 *   - A visit cannot exist on its own. We always create the job with the visit
 *     inline, which is what jobCreate's scheduling block is for.
 *
 * Not yet exercised against a real account. Marked TODO where a field name
 * could not be confirmed without credentials.
 */

import {
  ARRIVAL_WINDOW_MINUTES,
  DAY_END_HOUR,
  DAY_START_HOUR,
  TECHNICIANS,
  jobTypeById,
} from "../config";
import { decodeSlot, encodeSlot, speakWindow } from "./mock";
import type {
  CreateJobInput,
  CreateJobResult,
  CreateRequestInput,
  JobberClient,
  JobberClientInput,
  JobberGateway,
  OpenSlot,
  ScheduledVisit,
} from "./types";

const ENDPOINT = "https://api.getjobber.com/api/graphql";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
/** Pin this. Jobber batches removals every six months. */
const API_VERSION = process.env.JOBBER_API_VERSION || "2026-05-12";

type TokenState = { accessToken: string; refreshToken: string; expiresAt: number };

let tokens: TokenState | null = null;

/**
 * Where the rotated refresh token goes. In the demo it lives in memory, which
 * is fine for a session. In production this must be persisted, or a restart
 * loses the integration.
 */
async function persistRefreshToken(next: string): Promise<void> {
  if (process.env.JOBBER_REFRESH_TOKEN_SINK) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.JOBBER_REFRESH_TOKEN_SINK, next, "utf8");
  }
}

async function refreshAccessToken(): Promise<TokenState> {
  const clientId = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;
  const refreshToken = tokens?.refreshToken || process.env.JOBBER_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Jobber credentials are not set. Falling back to mock mode is handled in index.ts.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Jobber token refresh failed with ${res.status}. The refresh token may have been rotated away or revoked.`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const next: TokenState = {
    accessToken: json.access_token,
    // Rotation is on by default: if a new refresh token comes back, the old one is dead.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };

  if (json.refresh_token && json.refresh_token !== refreshToken) {
    await persistRefreshToken(json.refresh_token);
  }

  tokens = next;
  return next;
}

async function accessToken(): Promise<string> {
  if (tokens && tokens.expiresAt > Date.now()) return tokens.accessToken;
  return (await refreshAccessToken()).accessToken;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
};

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await accessToken();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new Error(
      throttled
        ? "Jobber throttled the request. Back off and retry."
        : `Jobber returned errors: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }

  if (!json.data) throw new Error("Jobber returned no data");
  return json.data;
}

/** Mutations report failure inside userErrors while still returning HTTP 200. */
function assertNoUserErrors(scope: string, userErrors?: { message: string; path?: string[] }[]) {
  if (userErrors?.length) {
    throw new Error(`${scope} failed: ${userErrors.map((e) => e.message).join("; ")}`);
  }
}

export class LiveJobber implements JobberGateway {
  readonly mode = "live" as const;

  async findClientByPhone(phone: string): Promise<JobberClient | null> {
    const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
    if (digits.length < 10) return null;

    const data = await gql<{
      clients: {
        nodes: {
          id: string;
          firstName: string | null;
          lastName: string | null;
          phones: { number: string }[];
          properties: { nodes: { id: string }[] };
        }[];
      };
    }>(
      `query FindClient($search: String!) {
         clients(first: 5, searchTerm: $search) {
           nodes {
             id
             firstName
             lastName
             phones { number }
             properties(first: 1) { nodes { id } }
           }
         }
       }`,
      { search: digits },
    );

    const match = data.clients.nodes.find((c) =>
      c.phones.some((p) => p.number.replace(/\D/g, "").slice(-10) === digits),
    );
    if (!match) return null;

    return {
      id: match.id,
      firstName: match.firstName ?? "",
      lastName: match.lastName ?? "",
      phone,
      propertyId: match.properties.nodes[0]?.id ?? "",
      existing: true,
    };
  }

  async createClient(input: JobberClientInput): Promise<JobberClient> {
    // Match before creating. Duplicate prevention is an explicit Jobber review
    // criterion and a duplicate client is a real annoyance for a dispatcher.
    const existing = await this.findClientByPhone(input.phone);
    if (existing) return existing;

    const data = await gql<{
      clientCreate: {
        client: { id: string; properties: { nodes: { id: string }[] } } | null;
        userErrors: { message: string; path?: string[] }[];
      };
    }>(
      `mutation CreateClient($input: ClientCreateInput!) {
         clientCreate(input: $input) {
           client {
             id
             properties(first: 1) { nodes { id } }
           }
           userErrors { message path }
         }
       }`,
      {
        input: {
          firstName: input.firstName,
          lastName: input.lastName,
          phones: [{ number: input.phone, primary: true, smsAllowed: true, description: "MAIN" }],
          emails: input.email ? [{ address: input.email, primary: true, description: "MAIN" }] : [],
          properties: [
            {
              address: {
                street1: input.address.street1,
                city: input.address.city,
                province: input.address.province,
                postalCode: input.address.postalCode,
                country: "United States",
              },
            },
          ],
        },
      },
    );

    assertNoUserErrors("clientCreate", data.clientCreate.userErrors);
    const client = data.clientCreate.client;
    if (!client) throw new Error("clientCreate returned no client");

    return {
      id: client.id,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      propertyId: client.properties.nodes[0]?.id ?? "",
      existing: false,
    };
  }

  /**
   * Jobber has a schedulingAvailability query that would do this for us and
   * even returns drive times, but it is absent from the public docs and its
   * payload carries subscription errors, so it is probably gated. Reading the
   * schedule and finding the gaps works on any account.
   */
  async findOpenSlots(args: {
    fromDate: Date;
    days: number;
    minutes: number;
    skill: string;
    urgency: string;
  }): Promise<OpenSlot[]> {
    const from = new Date(args.fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + args.days * 24 * 60 * 60_000);

    const data = await gql<{
      visits: {
        nodes: { startAt: string | null; endAt: string | null; assignedUsers: { nodes: { id: string }[] } }[];
      };
    }>(
      `query Booked($from: ISO8601DateTime!, $to: ISO8601DateTime!) {
         visits(first: 100, filter: { startAt: { after: $from, before: $to } }) {
           nodes {
             startAt
             endAt
             assignedUsers(first: 5) { nodes { id } }
           }
         }
       }`,
      { from: from.toISOString(), to: to.toISOString() },
    );

    const taken = data.visits.nodes
      .filter((v) => v.startAt && v.endAt)
      .flatMap((v) =>
        v.assignedUsers.nodes.map((u) => ({
          technicianId: u.id,
          start: new Date(v.startAt as string).getTime(),
          end: new Date(v.endAt as string).getTime(),
        })),
      );

    const emergency = args.urgency === "emergency";
    const latestHour = emergency ? DAY_END_HOUR + 3 : DAY_END_HOUR;

    // TODO map Jobber user ids onto TECHNICIANS once the real account exists.
    // Until then the local roster supplies skills and display names.
    const candidates = TECHNICIANS.filter((t) => args.skill === "any" || t.skills.includes(args.skill));
    const slots: OpenSlot[] = [];

    for (let day = 0; day < args.days && slots.length < 3; day++) {
      const date = new Date(from);
      date.setDate(date.getDate() + day);
      if (date.getDay() === 0 && !emergency) continue;

      for (let hour = DAY_START_HOUR; hour < latestHour && slots.length < 3; hour++) {
        for (const minute of [0, 30]) {
          const start = new Date(date);
          start.setHours(hour, minute, 0, 0);
          if (start.getTime() < Date.now() + 30 * 60_000) continue;
          const end = new Date(start.getTime() + args.minutes * 60_000);

          const tech = candidates.find(
            (t) =>
              !taken.some(
                (b) => b.technicianId === t.id && start.getTime() < b.end && end.getTime() > b.start,
              ),
          );
          if (!tech) continue;

          slots.push({
            id: encodeSlot(start, tech.id, args.minutes),
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            technicianId: tech.id,
            say: speakWindow(start, tech.id),
          });
          taken.push({ technicianId: tech.id, start: start.getTime(), end: end.getTime() });
          if (slots.length >= 3) break;
        }
      }
    }

    return slots;
  }

  async createScheduledJob(input: CreateJobInput): Promise<CreateJobResult> {
    const type = jobTypeById(input.jobTypeId);

    const data = await gql<{
      jobCreate: {
        job: { id: string; visits: { nodes: { id: string }[] } } | null;
        userErrors: { message: string; path?: string[] }[];
      };
    }>(
      `mutation CreateJob($input: JobCreateAttributes!) {
         jobCreate(input: $input) {
           job {
             id
             visits(first: 1) { nodes { id } }
           }
           userErrors { message path }
         }
       }`,
      {
        input: {
          clientId: input.clientId,
          propertyId: input.propertyId,
          title: input.title,
          instructions: input.instructions,
          // Required by Jobber even for a simple service call.
          invoicing: {
            invoicingType: "JOB_COMPLETION",
            invoicingSchedule: "ONCE",
          },
          arrivalWindow: { durationInMinutes: input.arrivalWindowMinutes || ARRIVAL_WINDOW_MINUTES },
          scheduling: {
            createVisits: true,
            notifyTeam: true,
            startTime: input.startAt.toISOString(),
            endTime: input.endAt.toISOString(),
            assignedTo: [input.technicianId],
          },
        },
      },
    );

    assertNoUserErrors("jobCreate", data.jobCreate.userErrors);
    const job = data.jobCreate.job;
    if (!job) throw new Error("jobCreate returned no job");

    return {
      jobId: job.id,
      visitId: job.visits.nodes[0]?.id ?? "",
      say: speakWindow(input.startAt, input.technicianId),
    };
  }

  async createRequest(input: CreateRequestInput): Promise<{ requestId: string }> {
    const data = await gql<{
      requestCreate: {
        request: { id: string } | null;
        userErrors: { message: string; path?: string[] }[];
      };
    }>(
      `mutation CreateRequest($input: RequestCreateInput!) {
         requestCreate(input: $input) {
           request { id }
           userErrors { message path }
         }
       }`,
      {
        input: {
          clientId: input.clientId,
          propertyId: input.propertyId,
          title: input.title,
          // Jobber notes this field is for external apps, which is us.
          requestDetails: input.details,
          source: "INTEGRATION",
        },
      },
    );

    assertNoUserErrors("requestCreate", data.requestCreate.userErrors);
    return { requestId: data.requestCreate.request?.id ?? "" };
  }

  async addNote(args: { clientId: string; message: string }): Promise<void> {
    const data = await gql<{
      clientCreateNote: { userErrors: { message: string; path?: string[] }[] };
    }>(
      `mutation AddNote($clientId: EncodedId!, $input: ClientCreateNoteInput!) {
         clientCreateNote(clientId: $clientId, input: $input) {
           userErrors { message path }
         }
       }`,
      { clientId: args.clientId, input: { message: args.message } },
    );
    assertNoUserErrors("clientCreateNote", data.clientCreateNote.userErrors);
  }

  async listVisits(args: { fromDate: Date; days: number }): Promise<ScheduledVisit[]> {
    const from = new Date(args.fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + args.days * 24 * 60 * 60_000);

    const data = await gql<{
      visits: {
        nodes: {
          id: string;
          title: string | null;
          startAt: string | null;
          endAt: string | null;
          job: { id: string } | null;
          client: { firstName: string | null; lastName: string | null } | null;
          assignedUsers: { nodes: { id: string }[] };
        }[];
      };
    }>(
      `query Board($from: ISO8601DateTime!, $to: ISO8601DateTime!) {
         visits(first: 100, filter: { startAt: { after: $from, before: $to } }) {
           nodes {
             id
             title
             startAt
             endAt
             job { id }
             client { firstName lastName }
             assignedUsers(first: 1) { nodes { id } }
           }
         }
       }`,
      { from: from.toISOString(), to: to.toISOString() },
    );

    return data.visits.nodes
      .filter((v) => v.startAt && v.endAt)
      .map((v) => ({
        id: v.id,
        jobId: v.job?.id ?? "",
        title: v.title ?? "Service call",
        startAt: new Date(v.startAt as string).toISOString(),
        endAt: new Date(v.endAt as string).toISOString(),
        assignedTechnicianId: v.assignedUsers.nodes[0]?.id ?? "",
        urgency: "routine",
        clientName:
          [v.client?.firstName, v.client?.lastName ? `${v.client.lastName[0]}.` : null]
            .filter(Boolean)
            .join(" ") || "Customer",
        createdByAgent: false,
      }));
  }
}

export { decodeSlot };
