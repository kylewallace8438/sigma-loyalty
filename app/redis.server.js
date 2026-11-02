// Connection options for BullMQ (it creates its own ioredis clients from these).
// REDIS_URL, when set, overrides the REDIS_* values, e.g. "rediss://default:pass@host:6380".
export function redisConnection(overrides = {}) {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL, ...overrides };
  }
  const tls = (process.env.REDIS_TLS || "false").toLowerCase() === "true";
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: tls ? {} : undefined,
    ...overrides,
  };
}
