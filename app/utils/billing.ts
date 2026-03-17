export const PLANS = {
    FREE: "FREE",
    PRO_MONTHLY: "PRO_MONTHLY",
    PRO_YEARLY: "PRO_YEARLY",
};

export const PLAN_CONFIG = {
    FREE: {
        price: 0,
        interval: "EVERY_30_DAYS",
        label: "Free Plan",
        features: ["price", "compare_price", "cost", "status"],
    },
    PRO_MONTHLY: {
        price: 15.0,
        interval: "EVERY_30_DAYS",
        label: "Pro Monthly",
        features: [
            "price",
            "compare_price",
            "cost",
            "status",
            "inventory",
            "tags",
            "metafield",
            "weight",
            "vendor",
            "product_type",
            "requires_shipping",
            "taxable",
        ],
    },
    PRO_YEARLY: {
        price: 150.0,
        interval: "ANNUAL",
        label: "Pro Yearly",
        features: [
            "price",
            "compare_price",
            "cost",
            "status",
            "inventory",
            "tags",
            "metafield",
            "weight",
            "vendor",
            "product_type",
            "requires_shipping",
            "taxable",
        ],
    },
};

export function isProPlan(planName: string | null) {
    if (!planName) return false;
    const p = planName.toUpperCase().replace("_", " "); // Normalize to spaces
    // Use includes to handle cases like "PRO MONTHLY (DISCOUNT applied)"
    return p.includes("PRO") || p.includes("ADVANCED");
}
