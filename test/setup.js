import { beforeEach, vi } from "vitest";

// Unit tests never touch MySQL or write log files: every module gets the in-memory fakes below.
vi.mock("../app/db.server", async () => ({ default: (await import("./mocks/db.js")).db }));
vi.mock("../app/logger.server", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  logger.child = () => logger;
  return { default: logger };
});

// Plans are cached per shop for a minute; each test starts without that cache.
beforeEach(async () => {
  (await import("../app/services/billing/plan.server.js")).clearPlanCache();
});
