import { Queue, Worker } from "bullmq";
import logger from "../../logger.server";
import { redisConnection } from "../../redis.server";
import { processWebhookJob } from "./handlers.server";

const QUEUE_NAME = "webhooks";
const HOUR_S = 60 * 60;
// Shopify waits 5s for a webhook response, but BullMQ waits for Redis indefinitely, so give up
// sooner and answer 500; Shopify re-sends later, and the job id stops a late add from running twice.
const ENQUEUE_TIMEOUT_MS = 3000;

const defaultJobOptions = {
  // 10s, 20s, 40s, ... (about 21 minutes in total) before the job is marked failed.
  attempts: 8,
  backoff: { type: "exponential", delay: 10_000 },
  // Completed job ids are kept for a day, so a re-sent delivery (same webhookId) isn't processed twice.
  removeOnComplete: { age: 24 * HOUR_S },
  removeOnFail: { age: 7 * 24 * HOUR_S },
};

// Reused across dev hot reloads so Redis connections aren't leaked.
function getQueue() {
  if (!global.webhookQueue) {
    global.webhookQueue = new Queue(QUEUE_NAME, { connection: redisConnection(), defaultJobOptions });
    global.webhookQueue.on("error", (err) => logger.error({ err }, "Webhook queue error"));
  }
  return global.webhookQueue;
}

/**
 * Queues a webhook verified by authenticate.webhook() for the worker. The delivery id is the job id,
 * so Shopify's retries of the same delivery are ignored while the job is still kept in Redis.
 */
export async function enqueueWebhook({ topic, shop, webhookId, apiVersion, payload }) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Queueing webhook timed out after ${ENQUEUE_TIMEOUT_MS}ms`)),
      ENQUEUE_TIMEOUT_MS,
    );
  });
  const add = getQueue().add(topic, { topic, shop, webhookId, apiVersion, payload }, { jobId: webhookId });
  await Promise.race([add, timeout]).finally(() => clearTimeout(timer));
  logger.info({ topic, shop, webhookId }, "Webhook queued");
}

// Starts the worker in this process. WEBHOOK_CONCURRENCY (default 5) jobs run at a time.
// Guarded on `global` so dev hot reloads don't start a second worker.
export function startWebhookWorker() {
  if (global.webhookWorker) return;
  const worker = new Worker(QUEUE_NAME, processWebhookJob, {
    // Workers hold blocking connections, which BullMQ requires to retry forever.
    connection: redisConnection({ maxRetriesPerRequest: null }),
    concurrency: Number(process.env.WEBHOOK_CONCURRENCY) || 5,
  });
  worker.on("failed", (job, err) => {
    const { topic, shop, webhookId } = job?.data ?? {};
    const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.error(
      { err, topic, shop, webhookId, attempt: job?.attemptsMade },
      final ? "Webhook job failed, giving up" : "Webhook job failed, will retry",
    );
  });
  worker.on("error", (err) => logger.error({ err }, "Webhook worker error"));
  global.webhookWorker = worker;

  // Open Redis connections keep the process alive after the HTTP server closes, so close them
  // (letting in-flight jobs finish) on shutdown.
  const shutdown = () =>
    Promise.all([worker.close(), global.webhookQueue?.close()]).catch((err) =>
      logger.error({ err }, "Webhook queue shutdown failed"),
    );
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
