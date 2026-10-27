import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { addDocumentResponseHeaders } from "./shopify.server";
import logger from "./logger.server";
import { scheduleOrderCleanup } from "./services/orders/cleanup.server";

scheduleOrderCleanup();

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  // Always send the fully rendered document (the template only did this for bots). With
  // onShellReady, late Suspense boundaries are patched in by React's inline `$RC` script, which
  // writes "$" into the node before its <template> placeholder. In the admin iframe App Bridge
  // (a blocking script) changes the DOM first, so that node can be a text node and a stray "$"
  // shows on every page. Loaders resolve before rendering anyway, so nothing is lost here.
  const callbackName = "onAllReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          logger.error({ err: error, url: request.url }, "SSR render error");
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
