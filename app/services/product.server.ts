import { authenticate } from "../shopify.server";
import { calculatePreview } from "./price-calculator";
import type { ProductNode, FilterOptions, PriceAdjustment } from "../types";

export type { ProductNode, FilterOptions, PriceAdjustment };
export { calculatePreview }; // Re-export for convenience

/**
 * Fetches products from Shopify Admin API based on filters.
 * Falls back to searching by query if no collectionId is provided.
 */
export async function fetchProducts(
  request: Request,
  filters: FilterOptions
): Promise<ProductNode[]> {
  const { admin } = await authenticate.admin(request);

  if (filters.collectionId) {
    const response = await admin.graphql(
      `#graphql
      query getCollectionProducts($id: ID!) {
        collection(id: $id) {
          products(first: 50) {
            edges {
              node {
                id
                title
                variants(first: 50) {
                  edges {
                    node {
                      id
                      price
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: { id: filters.collectionId },
      }
    );

    const responseJson = await response.json();
    if (responseJson.data?.collection?.products?.edges) {
      return responseJson.data.collection.products.edges.map(
        (edge: any) => edge.node
      );
    }
    return [];
  } else {
    // Construct search query
    const queryParts = [];
    if (filters.productType) queryParts.push(`product_type:${filters.productType}`);
    if (filters.tag) queryParts.push(`tag:${filters.tag}`);
    const query = queryParts.join(" AND ");

    const response = await admin.graphql(
      `#graphql
      query getProducts($query: String) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              variants(first: 50) {
                edges {
                  node {
                    id
                    price
                    title
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: { query },
      }
    );

    const responseJson = await response.json();
    if (responseJson.data?.products?.edges) {
      return responseJson.data.products.edges.map((edge: any) => edge.node);
    }
    return [];
  }
}
