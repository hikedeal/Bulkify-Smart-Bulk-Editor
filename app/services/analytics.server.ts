import prisma from "../db.server";

/**
 * Unified event tracking using Prisma and the local PostgreSQL database.
 */
export const trackEvent = async (shop_domain: string, event_name: string, metadata: any = {}) => {
    try {
        await prisma.appEvent.create({
            data: {
                shopDomain: shop_domain,
                eventName: event_name,
                metadata: metadata || {}
            }
        });
    } catch (error) {
        console.error(`[trackEvent] Error tracking ${event_name} for ${shop_domain}:`, error);
    }
};
