import { authenticate } from "../shopify.server";
import db from "../db.server";
import logger from "../logger.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  const current = payload.current;
  logger.info(current, "Received webhook");

//   if (session) {
//     await db.session.update({
//         where: {
//             id: session.id,
//         },
//         data: {
            
//         }
//     })
//   }

  return new Response();
};