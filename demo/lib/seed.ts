/**
 * Seeds a believable week for a four technician shop.
 *
 * Every customer here is invented. The board is deliberately busy but not
 * full: each technician keeps gaps so the agent always has something to offer,
 * and today is fuller than the rest of the week so the dispatch panel looks
 * like a real Tuesday rather than an empty grid.
 */

import { raw } from "./db";
import { DAY_END_HOUR, DAY_START_HOUR, JOB_TYPES, TECHNICIANS } from "./config";

export const DEMO_CLIENTS = [
  // The caller to use in the demo script. Known customer, so the agent
  // recognises the number and skips straight to the problem.
  { id: "cli_001", first: "Karen", last: "Dolan", phone: "+13125550188", zip: "60004", city: "Arlington Heights", street: "812 North Dunton Avenue" },
  { id: "cli_002", first: "Raymond", last: "Ortiz", phone: "+13125550142", zip: "60016", city: "Des Plaines", street: "245 Graceland Avenue" },
  { id: "cli_003", first: "Beth", last: "Sandoval", phone: "+13125550119", zip: "60067", city: "Palatine", street: "1140 West Palatine Road" },
  { id: "cli_004", first: "Anthony", last: "Pruitt", phone: "+13125550164", zip: "60193", city: "Schaumburg", street: "77 Springinsguth Road" },
  { id: "cli_005", first: "Marisol", last: "Vega", phone: "+13125550173", zip: "60056", city: "Mount Prospect", street: "410 South Elmhurst Road" },
  { id: "cli_006", first: "Glen", last: "Hardaway", phone: "+13125550155", zip: "60089", city: "Buffalo Grove", street: "1620 Weiland Road" },
  { id: "cli_007", first: "Priya", last: "Anand", phone: "+13125550127", zip: "60173", city: "Schaumburg", street: "1450 East American Lane" },
  { id: "cli_008", first: "Wes", last: "Fontaine", phone: "+13125550196", zip: "60090", city: "Wheeling", street: "300 East Dundee Road" },
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function at(offsetDays: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export async function seed(): Promise<void> {
  for (const c of DEMO_CLIENTS) {
    await raw(
      `insert into demo_clients
         (id, first_name, last_name, phone, property_id, street1, city, province, postal_code)
       values ($1,$2,$3,$4,$5,$6,$7,'IL',$8)
       on conflict (id) do nothing`,
      [c.id, c.first, c.last, c.phone, `prop_${c.id.slice(4)}`, c.street, c.city, c.zip],
    );
  }

  const random = rng(20260916);
  // Routine work only on the seeded board. Emergencies are what the agent adds.
  const seedTypes = JOB_TYPES.filter((t) => t.urgency === "routine" || t.urgency === "quote");
  let n = 0;

  for (let day = 0; day <= 6; day++) {
    const date = at(day, DAY_START_HOUR, 0);
    if (date.getDay() === 0) continue;

    for (const tech of TECHNICIANS) {
      let hour = DAY_START_HOUR;

      while (hour < DAY_END_HOUR - 1) {
        // Lunch, always blocked, makes the grid read like a real day.
        if (hour === 12) {
          hour += 1;
          continue;
        }

        const fill = random() < (day === 0 ? 0.72 : 0.5);
        if (!fill) {
          hour += 1;
          continue;
        }

        const candidates = seedTypes.filter((t) => tech.skills.includes(t.skill));
        const type = candidates.length
          ? candidates[Math.floor(random() * candidates.length)]
          : seedTypes[Math.floor(random() * seedTypes.length)];

        const client = DEMO_CLIENTS[Math.floor(random() * DEMO_CLIENTS.length)];
        const minute = random() < 0.5 ? 0 : 30;
        const start = at(day, hour, minute);
        const end = new Date(start.getTime() + type.minutes * 60_000);

        const jobId = `job_seed_${++n}`;
        await raw(
          `insert into demo_jobs (id, client_id, property_id, title, job_type_id, urgency)
           values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
          [jobId, client.id, `prop_${client.id.slice(4)}`, type.name, type.id, type.urgency],
        );
        await raw(
          `insert into demo_visits
             (id, job_id, client_id, technician_id, title, starts_at, ends_at, urgency, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')
           on conflict (id) do nothing`,
          [
            `vis_seed_${n}`,
            jobId,
            client.id,
            tech.id,
            type.name,
            start.toISOString(),
            end.toISOString(),
            type.urgency,
          ],
        );

        hour += Math.max(1, Math.ceil(type.minutes / 60));
      }
    }
  }
}
