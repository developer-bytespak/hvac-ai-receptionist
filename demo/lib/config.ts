/**
 * DEMO BRANDING AND DOMAIN RULES.
 *
 * This is the only file to edit when pointing the demo at a real contractor.
 * Swap the company, the service area postcodes, the technicians and the job
 * types, and everything else follows.
 *
 * Setting: a Chicago area heating and cooling contractor in mid September,
 * which is the start of heating season. That makes "no heat" the urgent call.
 */

export const COMPANY = {
  name: "Northline Heating and Cooling",
  shortName: "Northline",
  tagline: "Twenty four hour service across the northwest suburbs",
  /** The number the agent gives out. Replaced by the real number at go live. */
  mainNumber: "(312) 555-0137",
  timezone: "America/Chicago",
  /** Used by the revenue panel and never spoken to a caller. */
  currency: "USD",
};

/** Office hours. Outside these the after hours script and on-call rota apply. */
export const BUSINESS_HOURS = {
  weekdayOpenHour: 7,
  weekdayCloseHour: 17,
  saturdayOpenHour: 8,
  saturdayCloseHour: 13,
  sundayClosed: true,
};

export type Technician = {
  id: string;
  name: string;
  /** Shown on the dispatch board and spoken to the caller. */
  firstName: string;
  skills: string[];
  /** Day of week this technician carries the after hours phone, 0 is Sunday. */
  onCallDays: number[];
  tone: "blue" | "rust" | "moss" | "slate";
};

export const TECHNICIANS: Technician[] = [
  { id: "tech_kowalski", name: "Mike Kowalski", firstName: "Mike", skills: ["furnace", "boiler", "ac", "install"], onCallDays: [1, 4], tone: "blue" },
  { id: "tech_reyes", name: "Dave Reyes", firstName: "Dave", skills: ["furnace", "ac", "heatpump"], onCallDays: [2, 5], tone: "rust" },
  { id: "tech_brooks", name: "Tanya Brooks", firstName: "Tanya", skills: ["furnace", "ac", "thermostat", "diagnostic"], onCallDays: [3, 6], tone: "moss" },
  { id: "tech_whitmore", name: "Chris Whitmore", firstName: "Chris", skills: ["install", "ductwork", "estimate"], onCallDays: [0], tone: "slate" },
];

/**
 * The service area. A caller outside this list is declined politely and never
 * reaches dispatch, which is the point of scene two in the demo.
 */
export const SERVICE_AREA: { zip: string; town: string }[] = [
  { zip: "60004", town: "Arlington Heights" },
  { zip: "60005", town: "Arlington Heights" },
  { zip: "60008", town: "Rolling Meadows" },
  { zip: "60016", town: "Des Plaines" },
  { zip: "60018", town: "Des Plaines" },
  { zip: "60056", town: "Mount Prospect" },
  { zip: "60067", town: "Palatine" },
  { zip: "60074", town: "Palatine" },
  { zip: "60089", town: "Buffalo Grove" },
  { zip: "60090", town: "Wheeling" },
  { zip: "60169", town: "Hoffman Estates" },
  { zip: "60173", town: "Schaumburg" },
  { zip: "60193", town: "Schaumburg" },
  { zip: "60194", town: "Schaumburg" },
];

/** Known nearby postcodes we deliberately do not cover, for the demo. */
export const NEAR_MISS_ZIPS: { zip: string; town: string }[] = [
  { zip: "60614", town: "Chicago, Lincoln Park" },
  { zip: "61801", town: "Champaign" },
  { zip: "53202", town: "Milwaukee" },
];

export type Urgency = "emergency" | "urgent" | "routine" | "quote";

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  routine: "Routine",
  quote: "Estimate",
};

/**
 * Triage rules, in priority order. The first rule that matches wins.
 *
 * This is the part a generic receptionist does not do, and the reason the
 * custom build beats the off the shelf product. Keep it readable so the
 * contractor can argue with it and we can tune it on the retainer.
 */
export type TriageRule = {
  urgency: Urgency;
  /** Spoken back to the caller so they know they were heard. */
  reason: string;
  keywords: string[];
  /** Emergency work that must interrupt the on-call technician tonight. */
  dispatchTonight: boolean;
};

export const TRIAGE_RULES: TriageRule[] = [
  {
    urgency: "emergency",
    reason: "a possible gas leak",
    keywords: ["gas leak", "smell gas", "smells like gas", "gas smell", "rotten egg"],
    dispatchTonight: true,
  },
  {
    urgency: "emergency",
    reason: "a carbon monoxide alarm",
    keywords: ["carbon monoxide", "co alarm", "co detector", "monoxide"],
    dispatchTonight: true,
  },
  {
    urgency: "emergency",
    reason: "no heat",
    keywords: ["no heat", "furnace is dead", "furnace died", "heat is out", "heater not working", "no hot air", "freezing", "house is cold", "boiler is out"],
    dispatchTonight: true,
  },
  {
    urgency: "emergency",
    reason: "water coming from the system",
    keywords: ["water leak", "leaking water", "flooding", "water everywhere"],
    dispatchTonight: true,
  },
  {
    urgency: "urgent",
    reason: "no cooling",
    keywords: ["no ac", "no air conditioning", "ac is out", "not cooling", "blowing warm"],
    dispatchTonight: false,
  },
  {
    urgency: "urgent",
    reason: "a system making an unusual noise",
    keywords: ["banging", "grinding", "screeching", "burning smell", "smells like burning"],
    dispatchTonight: false,
  },
  {
    urgency: "quote",
    reason: "an estimate on a new system",
    keywords: ["new furnace", "replace", "replacement", "new system", "quote", "estimate", "how much", "price on"],
    dispatchTonight: false,
  },
  {
    urgency: "routine",
    reason: "a tune up",
    keywords: ["tune up", "tuneup", "maintenance", "service plan", "annual", "check up", "filter"],
    dispatchTonight: false,
  },
];

export type JobType = {
  id: string;
  name: string;
  minutes: number;
  urgency: Urgency;
  /** Typical invoice value, used only by the recovered revenue panel. */
  typicalTicket: number;
  skill: string;
};

export const JOB_TYPES: JobType[] = [
  { id: "no_heat", name: "No heat diagnostic", minutes: 90, urgency: "emergency", typicalTicket: 420, skill: "furnace" },
  { id: "no_cool", name: "No cooling diagnostic", minutes: 90, urgency: "urgent", typicalTicket: 380, skill: "ac" },
  { id: "gas_safety", name: "Gas or carbon monoxide safety call", minutes: 60, urgency: "emergency", typicalTicket: 350, skill: "diagnostic" },
  { id: "leak", name: "Water leak from system", minutes: 60, urgency: "emergency", typicalTicket: 340, skill: "diagnostic" },
  { id: "furnace_tuneup", name: "Furnace tune up", minutes: 60, urgency: "routine", typicalTicket: 149, skill: "furnace" },
  { id: "ac_tuneup", name: "Air conditioning tune up", minutes: 60, urgency: "routine", typicalTicket: 149, skill: "ac" },
  { id: "thermostat", name: "Thermostat fault", minutes: 45, urgency: "routine", typicalTicket: 210, skill: "thermostat" },
  { id: "replacement_estimate", name: "System replacement estimate", minutes: 60, urgency: "quote", typicalTicket: 7500, skill: "estimate" },
];

/** Questions the agent must ask before it books, by urgency. */
export const QUALIFYING_QUESTIONS: Record<Urgency, string[]> = {
  emergency: [
    "Is anyone in the home unwell, or do you smell gas right now?",
    "Is the thermostat calling for heat and the system is not responding?",
    "Roughly how old is the furnace?",
  ],
  urgent: [
    "Is the system running at all, or completely dead?",
    "Roughly how old is the system?",
    "Has it been serviced in the last year?",
  ],
  routine: [
    "Is this for a furnace, an air conditioner, or both?",
    "Roughly how old is the system?",
  ],
  quote: [
    "Is this to replace a furnace, an air conditioner, or a full system?",
    "Roughly how old is the current system?",
    "Is it a single family home, and roughly what square footage?",
  ],
};

/** Grid geometry for the dispatch board. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;
export const SLOT_MINUTES = 30;

/** Arrival window the agent promises, rather than a precise minute. */
export const ARRIVAL_WINDOW_MINUTES = 120;

export function technicianById(id: string) {
  return TECHNICIANS.find((t) => t.id === id);
}

export function jobTypeById(id: string) {
  return JOB_TYPES.find((j) => j.id === id);
}

export function inServiceArea(zip: string): { covered: boolean; town?: string } {
  const clean = String(zip ?? "").replace(/\D/g, "").slice(0, 5);
  const hit = SERVICE_AREA.find((s) => s.zip === clean);
  if (hit) return { covered: true, town: hit.town };
  const near = NEAR_MISS_ZIPS.find((s) => s.zip === clean);
  return { covered: false, town: near?.town };
}

/** Whoever is carrying the after hours phone on a given date. */
export function onCallTechnician(when: Date = new Date()): Technician {
  const day = when.getDay();
  return TECHNICIANS.find((t) => t.onCallDays.includes(day)) ?? TECHNICIANS[0];
}

export function isAfterHours(when: Date = new Date()): boolean {
  // Demos usually happen in the afternoon, but the story is an after hours
  // call. This lets you show the on-call pager scene at two in the afternoon.
  if (process.env.DEMO_FORCE_AFTER_HOURS === "true") return true;
  if (process.env.DEMO_FORCE_AFTER_HOURS === "false") return false;

  const day = when.getDay();
  const hour = when.getHours();
  if (day === 0) return BUSINESS_HOURS.sundayClosed;
  if (day === 6) return hour < BUSINESS_HOURS.saturdayOpenHour || hour >= BUSINESS_HOURS.saturdayCloseHour;
  return hour < BUSINESS_HOURS.weekdayOpenHour || hour >= BUSINESS_HOURS.weekdayCloseHour;
}

/**
 * Triage a caller's own words. Returns the first matching rule, or a routine
 * fallback so the agent always has somewhere to go.
 */
export function triage(text: string): TriageRule {
  const haystack = String(text ?? "").toLowerCase();
  for (const rule of TRIAGE_RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) return rule;
  }
  return {
    urgency: "routine",
    reason: "a service call",
    keywords: [],
    dispatchTonight: false,
  };
}
