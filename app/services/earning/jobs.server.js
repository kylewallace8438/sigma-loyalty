import logger from "../../logger.server";
import { expireDuePoints } from "../points/expiration.server";
import { resetExpiredTiers } from "../tiers/sync.server";
import { rewardDueBirthdays } from "./birthday.server";

const HOUR_MS = 60 * 60 * 1000;

/** One run of the scheduled jobs: birthday points, point expiration, then the VIP calendar-year reset. */
export async function runPointJobs(now = new Date()) {
  const birthdays = await rewardDueBirthdays(now);
  const expired = await expireDuePoints(now);
  const tiersReset = await resetExpiredTiers(now);
  logger.info({ birthdays, expired, tiersReset }, "Scheduled point jobs done");
}

// Runs the point jobs at startup, then hourly. Both jobs are safe to run twice (birthday points are
// keyed by year; expiration re-checks each customer in a transaction), so overlapping runs or
// several app instances don't award or expire twice. Guarded on `global` for dev hot reloads.
export function schedulePointJobs() {
  if (global.pointJobsTimer) return;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runPointJobs()
      .catch((err) => logger.error({ err }, "Scheduled point jobs failed"))
      .finally(() => {
        running = false;
      });
  };
  run();
  global.pointJobsTimer = setInterval(run, HOUR_MS).unref();
}
