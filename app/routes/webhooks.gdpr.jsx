import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log(`Received GDPR ${topic} webhook for ${shop}`);

    switch (topic) {
        case "CUSTOMERS_DATA_REQUEST":
            // This app does not store customer-specific data (only shop-level product data).
            // Return empty set to satisfy requirement.
            return new Response(JSON.stringify({}), { status: 200 });

        case "CUSTOMERS_REDACT":
            // This app does not store customer-specific data.
            console.log(`GDPR: No customer data to redact for ${shop}`);
            break;

        case "SHOP_REDACT":
            console.log(`GDPR: Commencing full data redaction for shop ${shop}`);
            try {
                // Perform a cascading delete of all data associated with this shop domain.
                // We'll use Prisma's separate deleteMany calls for tables without direct CASCADE relations in schema.

                await prisma.$transaction([
                    prisma.shopSettings.deleteMany({ where: { shopDomain: shop } }),
                    prisma.priceJob.deleteMany({ where: { shopDomain: shop } }),
                    prisma.taskRunItem.deleteMany({ where: { shop: shop } }),
                    prisma.taskRun.deleteMany({ where: { shop: shop } }),
                    // Missing in current schema: prisma.adminLog.deleteMany({ where: { shopDomain: shop } }),
                    // Wait, I just added AdminLog to schema.
                    prisma.adminLog.deleteMany({ where: { shopDomain: shop } }),
                    prisma.appEvent.deleteMany({ where: { shopDomain: shop } }),
                    prisma.discountRedemption.deleteMany({ where: { shop: shop } }),
                    prisma.shop.deleteMany({ where: { shop: shop } })
                ]);

                console.log(`GDPR: Successfully redacted all data for ${shop}`);
            } catch (err) {
                console.error(`GDPR: Failed to redact data for ${shop}:`, err);
                return new Response("Internal Server Error", { status: 500 });
            }
            break;

        default:
            console.warn(`Unhandled GDPR topic: ${topic}`);
    }

    return new Response();
};
