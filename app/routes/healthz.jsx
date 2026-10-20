import db from "../db.server";
import logger from "../logger.server";

// GET /healthz — liveness/readiness probe for Docker and the Cloudflare tunnel. Checks the database too.
export const loader = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok" });
  } catch (error) {
    logger.error({ err: error }, "Health check failed");
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
};
