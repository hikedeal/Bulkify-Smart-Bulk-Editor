import type { ProductNode, PriceAdjustment, VariantEdge, VariantNode } from "../types";

/**
 * Calculates the new prices for a list of products based on the adjustment.
 * Returns the products with an added 'newPrice' field in variants.
 */
export function calculatePreview(
    products: ProductNode[],
    adjustment: PriceAdjustment
): any[] {
    return products.map((product) => {
        const updatedVariants = product.variants.edges.map((vEdge) => {
            const variant = vEdge.node;
            const originalPrice = parseFloat(variant.price);
            let newPrice = originalPrice;

            if (adjustment.type === "percentage") {
                newPrice = originalPrice + originalPrice * (adjustment.value / 100);
            } else {
                newPrice = originalPrice + adjustment.value;
            }

            // Ensure price is not negative
            if (newPrice < 0) newPrice = 0;

            return {
                node: {
                    ...variant,
                    originalPrice: variant.price,
                    newPrice: newPrice.toFixed(2),
                },
            };
        });

        return {
            ...product,
            variants: {
                edges: updatedVariants,
            },
        };
    });
}
