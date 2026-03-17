// Analyze query costs for preview with 20 products per page

const previewCosts = {
    // Base cost per product (always included)
    base: 5,

    // Additional costs per field type
    price: {
        base: 5,
        variants: 2, // price, compareAtPrice per variant
        total: 7
    },

    compare_price: {
        base: 5,
        variants: 2,
        total: 7
    },

    tags: {
        base: 5,
        tags: 1,
        total: 6
    },

    cost: {
        base: 5,
        variants: 2,
        inventoryItem: 2, // unitCost
        total: 9
    },

    weight: {
        base: 5,
        variants: 2,
        inventoryItem: 2, // measurement.weight
        total: 9
    },

    inventory: {
        base: 5,
        variants: 2,
        inventoryItem: 2,
        inventoryLevels: 50, // 50 locations
        quantities: 5,
        total: 64
    },

    metafield: {
        base: 5,
        variants: 2,
        productMetafields: 10, // reduced to 10
        variantMetafields: 10, // reduced to 10
        total: 27
    },

    requires_shipping: {
        base: 5,
        variants: 2,
        inventoryItem: 2,
        total: 9
    },

    taxable: {
        base: 5,
        variants: 2,
        total: 7
    }
};

console.log("=== PREVIEW QUERY COST ANALYSIS (per product) ===\n");

const results = [];
for (const [field, costs] of Object.entries(previewCosts)) {
    const costPerProduct = costs.total;
    const maxProducts = Math.floor(1000 / costPerProduct);
    const currentPageSize = field === 'metafield' ? 5 : 20;
    const actualCost = currentPageSize * costPerProduct;
    const status = actualCost > 1000 ? "❌ OVER LIMIT" : actualCost > 800 ? "⚠️  HIGH" : "✅ OK";

    results.push({
        field,
        costPerProduct,
        maxProducts,
        currentPageSize,
        actualCost,
        status
    });
}

results.forEach(r => {
    console.log(`${r.field.padEnd(18)} Cost/product: ${String(r.costPerProduct).padStart(3)}  Max: ${String(r.maxProducts).padStart(3)}  Current: ${r.currentPageSize} products = ${String(r.actualCost).padStart(4)} cost  ${r.status}`);
});

console.log("\n=== RECOMMENDATIONS ===");
const needsFix = results.filter(r => r.actualCost > 1000);
const highCost = results.filter(r => r.actualCost > 800 && r.actualCost <= 1000);

if (needsFix.length > 0) {
    console.log("❌ CRITICAL - These will fail:");
    needsFix.forEach(r => {
        const recommended = Math.floor(1000 / r.costPerProduct);
        console.log(`  ${r.field}: reduce page size to ${recommended} products`);
    });
}

if (highCost.length > 0) {
    console.log("\n⚠️  WARNING - These are close to limit:");
    highCost.forEach(r => {
        const recommended = Math.floor(800 / r.costPerProduct);
        console.log(`  ${r.field}: consider reducing to ${recommended} products for safety`);
    });
}

const safe = results.filter(r => r.actualCost <= 800);
if (safe.length > 0) {
    console.log("\n✅ SAFE - These are fine:");
    safe.forEach(r => {
        console.log(`  ${r.field}: ${r.currentPageSize} products OK`);
    });
}
