import { afterEach, describe, expect, it, vi } from "vitest";
import { Queue } from "bullmq";
import { enqueueWebhook } from "../../../app/services/webhooks/queue.server";

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({}), on: vi.fn() })),
  Worker: vi.fn(),
}));

afterEach(() => delete global.webhookQueue);

describe("enqueueWebhook", () => {
  it("queues the webhook under its topic, with the delivery id as job id", async () => {
    const payload = { id: 1001 };
    await enqueueWebhook({
      topic: "ORDERS_CREATE",
      shop: "a.myshopify.com",
      webhookId: "wh-1",
      apiVersion: "2026-07",
      payload,
      session: { accessToken: "secret" },
    });

    const queue = Queue.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith(
      "ORDERS_CREATE",
      { topic: "ORDERS_CREATE", shop: "a.myshopify.com", webhookId: "wh-1", apiVersion: "2026-07", payload },
      { jobId: "wh-1" },
    );
  });

  it("propagates Redis errors so the route answers 500 and Shopify retries", async () => {
    Queue.mockImplementationOnce(() => ({ add: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")), on: vi.fn() }));

    await expect(
      enqueueWebhook({ topic: "SHOP_REDACT", shop: "a.myshopify.com", webhookId: "wh-2", payload: {} }),
    ).rejects.toThrow("ECONNREFUSED");
  });
  it("gives up after 3s when Redis doesn't answer, so Shopify gets a 500 in time", async () => {
    vi.useFakeTimers();
    Queue.mockImplementationOnce(() => ({ add: vi.fn(() => new Promise(() => {})), on: vi.fn() }));

    const result = expect(
      enqueueWebhook({ topic: "SHOP_REDACT", shop: "a.myshopify.com", webhookId: "wh-3", payload: {} }),
    ).rejects.toThrow("timed out after 3000ms");
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    vi.useRealTimers();
  });
});
