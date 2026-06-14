import { runSync } from "../lib/syncCore.mjs";

// Runs automatically every 10 minutes (Netlify cron) to pull the latest results.
export const config = { schedule: "*/10 * * * *" };

export default async () => {
  const result = await runSync();
  console.log("[scheduled sync]", JSON.stringify(result));
  return new Response("ok");
};
