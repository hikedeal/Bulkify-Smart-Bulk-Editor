import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    // 1. Fetch a location ID and Name for inventory (conditional)
    let locationId = null;
    let locationName = null;
    try {
        const locationResponse = await admin.graphql(
            `#graphql
            query getLocations {
                locations(first: 1) {
                    nodes {
                        id
                        name
                    }
                }
            }`
        );
        const locationData = await locationResponse.json() as any;
        const locationNode = locationData.data?.locations?.nodes?.[0];
        locationId = locationNode?.id;
        locationName = locationNode?.name;
    } catch (e) {
        console.warn("Could not fetch locations, proceeding without inventory initialization.", e);
    }

    // 2. Create demo product using productSet (idempotent and supports variants)
    const handle = "bulk-edit-demo-product-" + Math.floor(Math.random() * 10000);

    const variant1: any = {
        optionValues: [
            { optionName: "Color", name: "Red" },
            { optionName: "Size", name: "Small" }
        ],
        price: "100.00",
        compareAtPrice: "150.00"
    };
    const variant2: any = {
        optionValues: [
            { optionName: "Color", name: "Blue" },
            { optionName: "Size", name: "Medium" }
        ],
        price: "120.00",
        compareAtPrice: "160.00"
    };
    const variant3: any = {
        optionValues: [
            { optionName: "Color", name: "Green" },
            { optionName: "Size", name: "Large" }
        ],
        price: "100.00",
        compareAtPrice: "150.00"
    };

    if (locationId && locationName) {
        variant1.inventoryQuantities = [{ quantity: 50, locationId, name: locationName }];
        variant2.inventoryQuantities = [{ quantity: 25, locationId, name: locationName }];
        variant3.inventoryQuantities = [{ quantity: 10, locationId, name: locationName }];
    }

    const response = await admin.graphql(
        `#graphql
        mutation createDemoProduct($input: ProductSetInput!) {
            productSet(input: $input) {
                product {
                    id
                    title
                    handle
                    status
                    variants(first: 5) {
                        nodes {
                            id
                            title
                            price
                            compareAtPrice
                            inventoryQuantity
                        }
                    }
                }
                userErrors {
                    field
                    message
                }
            }
        }`,
        {
            variables: {
                input: {
                    title: "Bulk edit - Demo product",
                    handle: handle,
                    status: "DRAFT",
                    descriptionHtml: "<p>This is a demo product created for testing purposes.</p>",
                    tags: ["bulk-demo", "price-editor-demo"],
                    productOptions: [
                        { name: "Color", values: [{ name: "Red" }, { name: "Blue" }, { name: "Green" }] },
                        { name: "Size", values: [{ name: "Small" }, { name: "Medium" }, { name: "Large" }] }
                    ],
                    variants: [variant1, variant2, variant3]
                }
            }
        }
    );

    const data = await response.json();
    const createdProduct = data.data?.productSet?.product;

    // 3. Save to Prisma
    if (createdProduct?.id) {
        const { session } = await authenticate.admin(request);
        const { shop } = session;

        try {
            await prisma.demoProduct.create({
                data: {
                    shop: shop,
                    productId: createdProduct.id,
                    createdAt: new Date()
                }
            });
        } catch (dbError) {
            console.warn("Failed to save demo product to Prisma:", dbError);
            // Don't fail the request, just log it
        }
    }

    return data;
};
