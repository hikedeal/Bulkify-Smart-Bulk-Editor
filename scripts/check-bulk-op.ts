import { shopify } from "../app/shopify.server";
import { sessionStorage } from "../app/shopify.server";

async function checkBulkOp() {
    const shopDomain = "hikedeal-2.myshopify.com"; // Hardcoded from context
    const sessions = await sessionStorage.findSessionsByShop(shopDomain);
    const offlineSession = sessions.find((s) => s.isOnline === false);

    if (!offlineSession) {
        console.error("No offline session found");
        return;
    }

    const client = new shopify.api.clients.Graphql({ session: offlineSession });
    const bulkOpId = "gid://shopify/BulkOperation/5036237094969";

    const response = await client.request(`
        query {
            node(id: "${bulkOpId}") {
                ... on BulkOperation {
                    id
                    status
                    errorCode
                    createdAt
                    completedAt
                    objectCount
                    fileSize
                    url
                }
            }
        }
    `);

    console.log(JSON.stringify(response.body, null, 2));
}

checkBulkOp()
    .catch(console.error);
