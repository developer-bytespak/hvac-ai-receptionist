/**
 * The narrow slice of Jobber the receptionist actually needs.
 *
 * Both the live GraphQL client and the mock implement this, so the tool
 * handlers never know which one they are talking to. That is what lets the
 * demo run today with no accounts and flip to a real Jobber account by
 * setting two environment variables.
 */

export type JobberClientInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address: {
    street1: string;
    city: string;
    province: string;
    postalCode: string;
  };
};

export type JobberClient = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  propertyId: string;
  /** True when we matched an existing record rather than creating one. */
  existing: boolean;
};

export type ScheduledVisit = {
  id: string;
  jobId: string;
  title: string;
  startAt: string;
  endAt: string;
  assignedTechnicianId: string;
  urgency: string;
  clientName: string;
  /** Set when the visit was created by the agent rather than seeded. */
  createdByAgent: boolean;
};

export type CreateJobInput = {
  clientId: string;
  propertyId: string;
  title: string;
  instructions: string;
  jobTypeId: string;
  urgency: string;
  startAt: Date;
  endAt: Date;
  technicianId: string;
  arrivalWindowMinutes: number;
};

export type CreateJobResult = {
  jobId: string;
  visitId: string;
  /** Human sentence the agent reads back to the caller. */
  say: string;
};

export type CreateRequestInput = {
  clientId: string;
  propertyId: string;
  title: string;
  details: string;
};

export type OpenSlot = {
  /** Self describing so booking needs no server side cache between turns. */
  id: string;
  startAt: string;
  endAt: string;
  technicianId: string;
  /** Sentence the agent speaks, for example "today between 4 and 6 with Mike". */
  say: string;
};

/**
 * Everything the receptionist can do to Jobber. Deliberately small: if a tool
 * needs something that is not here, it does not belong in a phone call.
 */
export interface JobberGateway {
  /** Which implementation is live, shown in the demo header. */
  readonly mode: "mock" | "live";

  /** Match on phone first, then name, to avoid duplicate clients. */
  findClientByPhone(phone: string): Promise<JobberClient | null>;

  createClient(input: JobberClientInput): Promise<JobberClient>;

  /**
   * Open slots computed from what is already on the technicians' days.
   * Jobber's own availability query looks subscription gated, so we read the
   * schedule and find the gaps ourselves.
   */
  findOpenSlots(args: {
    fromDate: Date;
    days: number;
    minutes: number;
    skill: string;
    urgency: string;
  }): Promise<OpenSlot[]>;

  createScheduledJob(input: CreateJobInput): Promise<CreateJobResult>;

  /** Used for estimates, which go to sales rather than dispatch. */
  createRequest(input: CreateRequestInput): Promise<{ requestId: string }>;

  addNote(args: { clientId: string; message: string }): Promise<void>;

  /** Drives the dispatch board. */
  listVisits(args: { fromDate: Date; days: number }): Promise<ScheduledVisit[]>;
}
