// Query cost analysis for different field types
// Based on Shopify's GraphQL cost calculation

const fieldCosts = {
    // Basic variant fields (always included)
    base: {
        id: 0,
        title: 0,
        price: 0,
        compareAtPrice: 0,
        sku: 0,
        taxable: 0,
        image: 1,
    },

    // Inventory fields
    inventory: {
        inventoryItem: 1,
        inventoryLevels: 50, // 50 locations * 1 cost each
        quantities: 10, // per location
    },

    // Metafields
    metafield: {
        productMetafields: 50, // 50 metafields * 1 cost each
        variantMetafields: 50,
    },

    // Cost/Weight fields
    cost: {
        inventoryItem: 1,
        unitCost: 1,
        measurement: 1,
    },

    // Tags (product level)
    tags: {
        tags: 1,
    },

    // Price/Compare Price
    price: {
        price: 0,
        compareAtPrice: 0,
    }
};

// Estimated costs per product with variants
const estimatedCosts = {
    price: 10, // Base fields only
    compare_price: 10,
    tags: 10,
    cost: 15, // Base + inventoryItem
    weight: 15,
    inventory: 70, // Base + inventoryItem + inventoryLevels(50) + quantities(10)
    metafield: 120, // Base + productMetafields(50) + variantMetafields(50)
    requires_shipping: 15,
    taxable: 10,
};

// Products per query before hitting 1000 limit
const maxProductsPerQuery = {
    price: Math.floor(1000 / 10), // ~100 products
    compare_price: Math.floor(1000 / 10), // ~100 products
    tags: Math.floor(1000 / 10), // ~100 products
    cost: Math.floor(1000 / 15), // ~66 products
    weight: Math.floor(1000 / 15), // ~66 products
    inventory: Math.floor(1000 / 70), // ~14 products
    metafield: Math.floor(1000 / 120), // ~8 products
    requires_shipping: Math.floor(1000 / 15), // ~66 products
    taxable: Math.floor(1000 / 10), // ~100 products
};

console.log("=== QUERY COST ANALYSIS ===\n");
console.log("Estimated cost per product (with variants):");
Object.entries(estimatedCosts).forEach(([field, cost]) => {
    console.log(`  ${field.padEnd(20)} ${cost} points`);
});

console.log("\n=== MAX PRODUCTS PER QUERY (1000 limit) ===");
Object.entries(maxProductsPerQuery).forEach(([field, max]) => {
    const needsBulk = max < 50;
    const status = needsBulk ? "⚠️  NEEDS BULK API" : "✅ OK";
    console.log(`  ${field.padEnd(20)} ${String(max).padStart(3)} products  ${status}`);
});

console.log("\n=== RECOMMENDATIONS ===");
console.log("Fields that should use Bulk API threshold < 100:");
console.log("  - inventory (threshold: 50)");
console.log("  - metafield (threshold: 50)");
console.log("  - cost (threshold: 100)");
console.log("  - weight (threshold: 100)");
console.log("\nFields that are safe with current settings:");
console.log("  - price, compare_price, tags, taxable (threshold: 100)");
