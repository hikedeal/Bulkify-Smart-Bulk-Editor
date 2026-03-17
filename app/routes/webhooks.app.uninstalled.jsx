import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // 1. Mark as uninstalled in our Analytics DB
  try {
    await db.shop.update({
      where: { shop },
      data: { uninstalledAt: new Date() }
    });
  } catch (err) {
    console.error("Failed to mark shop as uninstalled in Prisma:", err);
  }

  // 2. Cleanup Prisma session
  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
