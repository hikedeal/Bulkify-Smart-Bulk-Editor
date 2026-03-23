import { getAuthenticatedAdmin } from "./auth.server";

export async function getShopFieldStructure(shopDomain: string) {
    const admin = await getAuthenticatedAdmin(shopDomain);

    const [metafieldDefs, publications, markets] = await Promise.all([
        fetchMetafieldDefinitions(admin),
        fetchPublications(admin),
        fetchMarkets(admin)
    ]);

    return {
        metafieldDefinitions: metafieldDefs,
        publications: publications,
        markets: markets
    };
}

async function fetchMetafieldDefinitions(admin: any) {
    const query = `
        query metafieldDefinitions($ownerType: MetafieldOwnerType!) {
            metafieldDefinitions(first: 250, ownerType: $ownerType) {
                edges {
                    node {
                        name
                        namespace
                        key
                        type { name }
                    }
                }
            }
        }
    `;

    const [productDefs, variantDefs] = await Promise.all([
        admin.graphql(query, { variables: { ownerType: "PRODUCT" } }),
        admin.graphql(query, { variables: { ownerType: "PRODUCTVARIANT" } })
    ]);

    const pData = await productDefs.json();
    const vData = await variantDefs.json();

    return {
        product: (pData.data?.metafieldDefinitions?.edges || []).map((e: any) => e.node),
        variant: (vData.data?.metafieldDefinitions?.edges || []).map((e: any) => e.node)
    };
}

async function fetchPublications(admin: any) {
    const query = `
        query publications {
            publications(first: 250) {
                edges {
                    node {
                        id
                        name
                    }
                }
            }
        }
    `;

    const response = await admin.graphql(query);
    const data = await response.json();

    return (data.data?.publications?.edges || []).map((e: any) => e.node);
}

async function fetchMarkets(admin: any) {
    const query = `
        query markets {
            markets(first: 250) {
                edges {
                    node {
                        id
                        name
                        enabled
                    }
                }
            }
        }
    `;

    const response = await admin.graphql(query);
    const data = await response.json();

    return (data.data?.markets?.edges || []).map((e: any) => e.node);
}
