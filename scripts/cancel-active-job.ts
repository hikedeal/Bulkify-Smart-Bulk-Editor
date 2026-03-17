
import prisma from "../app/db.server.js";
import { shopifyApi } from "@shopify/shopify-api";
import '@shopify/shopify-api/adapters/node';

const API_VERSION = "2024-10";

// Initialize Shopify API (minimal config for graphQL client)
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SCOPES || "").split(","),
  hostName: "localhost",
  apiVersion: API_VERSION,
  isEmbeddedApp: true,
});

async function main() {
  console.log("Starting cancellation script...");
  const sessions = await prisma.session.findMany();

  for (const session of sessions) {
    if (!session.accessToken) continue;

    console.log(`Checking shop: ${session.shop}`);

    // Create a client manually since we are outside the remix context
    const client = new shopify.clients.Graphql({
      session: {
        ...session,
        isActive: () => true,
      },
    });

    try {
      // 1. Check current operation
      const query = `
        query {
          currentBulkOperation {
            id
            status
            errorCode
            createdAt
          }
        }
      `;
      const response = await client.request(query);
      const op = (response.data as any).currentBulkOperation;

      if (op && op.status === 'RUNNING') {
        console.log(`Found RUNNING operation: ${op.id} (Created: ${op.createdAt})`);

        // 2. Cancel it
        const cancelMutation = `
          mutation {
            bulkOperationCancel(id: "${op.id}") {
              bulkOperation {
                status
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const cancelResponse = await client.request(cancelMutation);
        console.log("Cancel response:", JSON.stringify((cancelResponse.data as any), null, 2));
      } else {
        console.log(`No running operation for ${session.shop}. Status: ${op?.status || 'NONE'}`);
      }

    } catch (err: any) {
      console.error(`Failed to process ${session.shop}:`, err.message);
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
