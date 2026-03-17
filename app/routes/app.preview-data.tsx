import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    console.log("🔍 PREVIEW-DATA CALLED - fieldToEdit:", formData.get("fieldToEdit"));

    const applyToProducts = formData.get("applyToProducts") as string;
    const selectedProducts = JSON.parse(formData.get("selectedProducts") as string || "[]");
    const selectedCollections = JSON.parse(formData.get("selectedCollections") as string || "[]");
    const productConditions = JSON.parse(formData.get("productConditions") as string || "[]");
    const productMatchLogic = formData.get("productMatchLogic") as string;
    const applyToVariants = formData.get("applyToVariants") as string;
    const variantMatchLogic = formData.get("variantMatchLogic") as string;
    const variantConditions = JSON.parse(formData.get("variantConditions") as string || "[]");
    const excludeSpecificProducts = formData.get("excludeSpecificProducts") === "true";
    const excludedProductsList = JSON.parse(formData.get("excludedProductsList") as string || "[]");

    const fieldToEdit = formData.get("fieldToEdit") as string;
    const locationId = formData.get("locationId") as string;
    const metafieldNamespace = formData.get("metafieldNamespace") as string;
    const metafieldKey = formData.get("metafieldKey") as string;

    // DEBUG: Log metafield parameters
    if (fieldToEdit === 'metafield') {
        console.log("📦 PREVIEW-DATA RECEIVED:", { fieldToEdit, metafieldNamespace, metafieldKey });
    }

    let query = "";

    switch (applyToProducts) {
        case "specific":
            const ids = selectedProducts.map((p: any) => p.id.split("/").pop()).join(" OR ");
            if (ids) query = `id:${ids}`;
            break;
        case "collections":
            if (selectedCollections.length > 0) {
                const collectionId = selectedCollections[0].id.split("/").pop();
                query = `collection_id:${collectionId}`;
            }
            break;
        case "conditions":
            if (productConditions.some((c: any) => c.property === 'metafield')) {
                console.log("DEBUG METAFIELD FILTER:", JSON.stringify(productConditions, null, 2));
            } else {
                console.log("Processing product conditions:", JSON.stringify(productConditions));
            }
            const parts = productConditions.map((c: any) => {
                if (!c.value) return null;
                let field = c.property;

                // Map frontend properties to Shopify query fields
                if (field === "title") field = "title";
                if (field === "status") field = "status";
                if (field === "handle") field = "handle";
                if (field === "collection") field = "collection_id";
                if (field === "tag") field = "tag";
                if (field === "type") field = "product_type";
                if (field === "vendor") field = "vendor";
                if (field === "created_at") field = "created_at";
                if (field === "updated_at") field = "updated_at";
                if (field === "item_price") field = "variants.price";
                if (field === "inventory_total") field = "inventory_total";

                if (field === "metafield") {
                    if (c.metafieldKey) {
                        field = `metafields.${c.metafieldKey}`;
                    } else if (c.metafieldNamespace && c.originalKey) {
                        field = `metafields.${c.metafieldNamespace}.${c.originalKey}`;
                    } else {
                        // Invalid metafield condition (missing key)
                        return null;
                    }
                }

                let value = c.value;
                if (field === "status") value = value.toLowerCase();
                let op = ":";

                if (c.operator === "contains") {
                    // Metafields: heavy wildcarding (*val*) is often not supported. Use prefix (val*) or exact ("val")
                    if (field.startsWith("metafields.")) {
                        return `(${field}:${value}* OR ${field}:"${value}")`;
                    }
                    // Robustness: Try both wildcard and exact match (quoted) to handle fields that may not support wildcards (like some lists)
                    return `(${field}:*${value}* OR ${field}:"${value}")`;
                }

                if (c.operator === "starts_with") value = `${value}*`;
                else if (c.operator === "ends_with") value = `*${value}`;
                else if (c.operator === "greater_than") op = ":>";
                else if (c.operator === "less_than") op = ":<";

                if (c.operator === "equals" || field === "status" || field === "collection_id" || field === "id") {
                    op = ":";
                    if (field === "status" || field === "id") value = c.value.toLowerCase();
                    // Quote metafield values for proper Shopify search syntax
                    if (field.startsWith("metafields.")) {
                        return `(${field}:"${value}")`;
                    }
                }

                return `(${field}${op}${value})`;
            }).filter(Boolean);

            if (parts.length > 0) {
                const joiner = productMatchLogic === "any" ? " OR " : " AND ";
                query = parts.join(joiner);
            }
            break;
        case "all":
        default:
            query = "";
            break;
    }

    const cursor = formData.get("cursor") as string | null;
    const direction = formData.get("direction") as string | null;

    // Reduce page size for high-cost fields to avoid query cost limits
    const pageSize = fieldToEdit === 'metafield' ? 5 : fieldToEdit === 'inventory' ? 15 : 20;
    let paginationArgs = `first: ${pageSize}`;
    if (cursor && direction === "next") paginationArgs = `first: ${pageSize}, after: "${cursor}"`;
    else if (cursor && direction === "prev") paginationArgs = `last: ${pageSize}, before: "${cursor}"`;

    // DEBUG: Log state before validation
    console.log("=== QUERY VALIDATION ===", {
        applyToProducts,
        query,
        queryLength: query?.length || 0,
        productConditionsCount: productConditions?.length || 0
    });

    // If conditions mode is active but query is empty (and user added conditions), 
    // it means conditions were invalid or filtered out. We should return NO products to avoid confusion.
    // If user added NO conditions (array empty), then we default to ALL products (existing behavior).
    if (!query && applyToProducts === 'conditions' && productConditions.length > 0) {
        console.log("=== RETURNING EMPTY: Invalid conditions ===");
        return { products: [], pageInfo: {} };
    }

    if (!query && applyToProducts === 'specific' && selectedProducts.length === 0) {
        return { products: [], pageInfo: {} };
    }

    const isMetafieldEdit = fieldToEdit === 'metafield' && metafieldNamespace && metafieldKey;
    const metafieldFragment = isMetafieldEdit ? `
        metafields(first: 10, namespace: "${metafieldNamespace}") {
            edges {
                node {
                    namespace
                    key
                    value
                    type
                }
            }
        }
    ` : "";

    const countryCode = formData.get("countryCode") as string | null;

    const queryInfo = countryCode ? `query getPreviewProducts($query: String!, $countryCode: CountryCode!)` : `query getPreviewProducts($query: String!)`;

    const response = await admin.graphql(
        `#graphql
        ${queryInfo} {
            products(${paginationArgs}, query: $query) {
                pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                }
                nodes {
                    id
                    title
                    handle
                    vendor
                    productType
                    status
                    tags
                    featuredImage {
                        url
                    }
                    totalInventory
                    ${metafieldFragment}
                    variants(first: 50) {
                        nodes {
                            id
                            title
                            price
                            compareAtPrice
                            ${countryCode ? `
                            contextualPricing(context: { country: $countryCode }) {
                                price {
                                    amount
                                }
                                compareAtPrice {
                                    amount
                                }
                            }
                            ` : ""}
                            sku
                            inventoryQuantity
                            selectedOptions {
                                name
                                value
                            }
                            inventoryItem {
                                inventoryLevels(first: 50) {
                                    edges {
                                        node {
                                            location {
                                                id
                                            }
                                            quantities(names: ["available"]) {
                                                name
                                                quantity
                                            }
                                        }
                                    }
                                }
                                unitCost {
                                    amount
                                }
                                measurement {
                                    weight {
                                        value
                                        unit
                                    }
                                }
                                requiresShipping
                                tracked
                            }
                            taxable
                            ${metafieldFragment}
                        }
                    }
                }
            }
            productsCount(query: $query, limit: null) {
                count
            }
        }`,
        { variables: { query, ...(countryCode ? { countryCode } : {}) } }
    );

    // DEBUG: Log query to console for inspection
    // if (applyToProducts === 'conditions') {
    //     console.error("🎯 === FINAL QUERY STRING ===", query);
    // }

    const responseJson = await response.json() as any;
    if (responseJson.errors) return { products: [], error: responseJson.errors };

    const productsData = responseJson.data?.products?.nodes || [];
    const productsCountData = responseJson.data?.productsCount || { count: 0 };

    // DEBUG: Include query in response for inspection
    const debugInfo = applyToProducts === 'conditions' ? { debugQuery: query } : {};

    // Filter out excluded products
    const excludedIds = new Set(excludedProductsList.map((p: any) => p.id));
    const filteredProductsData = excludeSpecificProducts
        ? productsData.filter((product: any) => !excludedIds.has(product.id))
        : productsData;

    const processedProducts = filteredProductsData.map((product: any) => {
        let filteredVariants = product.variants?.nodes || [];

        if (applyToVariants === 'conditions' && variantConditions.length > 0) {
            filteredVariants = (product.variants?.nodes || []).filter((variant: any) => {
                const results = variantConditions.map((c: any) => {
                    if (!c.value && !['price', 'compare_at', 'inventory'].includes(c.property)) return true;

                    let targetValue = "";
                    if (c.property === "title") targetValue = variant.title;
                    if (c.property === "sku") targetValue = variant.sku || "";
                    if (c.property === "price") targetValue = variant.price;
                    if (c.property === "compare_at") targetValue = variant.compareAtPrice || "0";
                    if (c.property === "inventory") targetValue = variant.inventoryQuantity?.toString() || "0";

                    if (c.property === "option_name") {
                        return variant.selectedOptions.some((opt: any) => {
                            const val = opt.name.toLowerCase();
                            const search = c.value.toLowerCase();
                            if (c.operator === "contains") return val.includes(search);
                            if (c.operator === "equals") return val === search;
                            return false;
                        });
                    }
                    if (c.property === "option_value") {
                        return variant.selectedOptions.some((opt: any) => {
                            const val = opt.value.toLowerCase();
                            const search = c.value.toLowerCase();
                            if (c.operator === "contains") return val.includes(search);
                            if (c.operator === "equals") return val === search;
                            return false;
                        });
                    }

                    const searchVal = c.value.toLowerCase();
                    const targetValLower = targetValue.toLowerCase();

                    if (['price', 'compare_at', 'inventory'].includes(c.property)) {
                        const nTarget = parseFloat(targetValue) || 0;
                        const nSearch = parseFloat(c.value) || 0;
                        if (c.operator === "equals") return nTarget === nSearch;
                        if (c.operator === "greater_than") return nTarget > nSearch;
                        if (c.operator === "less_than") return nTarget < nSearch;
                        return false;
                    }

                    if (c.operator === "contains") return targetValLower.includes(searchVal);
                    if (c.operator === "equals") return targetValLower === searchVal;
                    return false;
                });

                return variantMatchLogic === 'any' ? results.some((r: boolean) => r === true) : results.every((r: boolean) => r === true);
            });
        }

        return {
            id: product.id,
            title: product.title,
            handle: product.handle,
            vendor: product.vendor,
            productType: product.productType,
            status: product.status,
            tags: product.tags,
            image: product.featuredImage?.url,
            metafields: product.metafields,
            variants: filteredVariants.map((v: any) => ({
                id: v.id,
                title: v.title === 'Default Title' ? '' : v.title,
                price: v.contextualPricing?.price?.amount ?? v.price,
                compareAtPrice: v.contextualPricing ? (v.contextualPricing.compareAtPrice?.amount ?? null) : v.compareAtPrice,
                sku: v.sku,
                inventory: (() => {
                    const extractPlainId = (gid: any) => {
                        if (!gid || typeof gid !== 'string') return gid;
                        return gid.split('/').pop()?.split('?')[0];
                    };

                    if (fieldToEdit !== 'inventory') return v.inventoryQuantity;
                    const levels = v.inventoryItem?.inventoryLevels?.edges || [];
                    if (locationId) {
                        const targetLevel = levels.find((l: any) => extractPlainId(l.node.location.id) === extractPlainId(locationId));
                        if (targetLevel) {
                            const quantities = targetLevel.node.quantities || [];
                            return quantities.find((q: any) => q.name === "available")?.quantity ?? (quantities[0]?.quantity || 0);
                        }
                        return 0;
                    }
                    // Fallback to first available if no location selected or found
                    if (levels.length > 0) {
                        const quantities = levels[0].node.quantities || [];
                        return quantities.find((q: any) => q.name === "available")?.quantity ?? (quantities[0]?.quantity || 0);
                    }
                    return v.inventoryQuantity;
                })(),
                cost: v.inventoryItem?.unitCost?.amount || "0.00",
                metafields: v.metafields,
                weight: v.inventoryItem?.measurement?.weight?.value || 0,
                weightUnit: v.inventoryItem?.measurement?.weight?.unit || "KILOGRAMS",
                requiresShipping: v.inventoryItem?.requiresShipping,
                taxable: v.taxable
            }))
        };
    }).filter((p: any) => p.variants.length > 0);

    return {
        products: processedProducts,
        pageInfo: responseJson.data?.products?.pageInfo || {},
        totalCount: productsCountData.count
    };
};
