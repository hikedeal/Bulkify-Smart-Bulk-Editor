import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("Payload:", JSON.stringify(payload, null, 2));

    // Mandatory: Handle shop data deletion compliance
    // This webhook is triggered 48 hours after a shop uninstalls your app
    if (shop) {
        try {
            // Clean up your database records for this shop
            // Using transaction for robustness similar to GDPR
            await prisma.$transaction([
                prisma.shopSettings.deleteMany({ where: { shopDomain: shop } }),
                prisma.priceJob.deleteMany({ where: { shopDomain: shop } }),
                prisma.taskRunItem.deleteMany({ where: { shop: shop } }),
                prisma.taskRun.deleteMany({ where: { shop: shop } }),
                prisma.adminLog.deleteMany({ where: { shopDomain: shop } }),
                prisma.appEvent.deleteMany({ where: { shopDomain: shop } }),
                prisma.discountRedemption.deleteMany({ where: { shop: shop } }),
                prisma.shop.deleteMany({ where: { shop: shop } })
            ]);
            console.log(`Compliance: Shop ${shop} data cleanup complete.`);
        } catch (error) {
            console.error(`Failed to handle shop/redact for ${shop}:`, error);
        }
    }

    return new Response();
};
