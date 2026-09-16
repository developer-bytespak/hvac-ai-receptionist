/**
 * Rebuilds the demo week from the command line.
 *
 *   npm run seed
 *
 * Run it before a demo, or after editing lib/config.ts. With DATABASE_URL set
 * this reseeds that database, otherwise it rebuilds the local PGlite store.
 */

import { q, resetDemo } from "./db";
import { jobber } from "./jobber";
import { smsMode } from "./sms";

async function main() {
  const target = process.env.DATABASE_URL ? "the configured Postgres database" : "the local PGlite store";
  console.log(`Reseeding ${target}...`);

  await resetDemo();

  const [counts] = await q<{ clients: number; visits: number }>(
    `select (select count(*)::int from demo_clients) as clients,
            (select count(*)::int from demo_visits)  as visits`,
  );

  console.log(`Done. ${counts.clients} customers, ${counts.visits} visits on the board.`);
  console.log(`Jobber gateway: ${jobber().mode}. SMS: ${smsMode()}.`);
  console.log("Call history, pipeline and messages are empty and ready for a fresh call.");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
