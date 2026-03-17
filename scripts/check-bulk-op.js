import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shopDomain = process.argv[2];
const specificId = process.argv[3] || "gid://shopify/BulkOperation/5024844841017";

if (!shopDomain) {
    console.error("Please provide a shop domain as an argument.");
    process.exit(1);
}

async function main() {
    console.log(`Checking specific bulk operation ${specificId} on ${shopDomain}...`);
    try {
        const session = await prisma.session.findFirst({
            where: { shop: shopDomain, isOnline: false }
        });

        if (!session || !session.accessToken) {
            console.error(`No offline session found for ${shopDomain}`);
            return;
        }

        const query = `
        query {
            node(id: "${specificId}") {
                ... on BulkOperation {
                    id
                    status
                    errorCode
                    createdAt
                    completedAt
                }
            }
        }`;

        const response = await fetch(`https://${shopDomain}/admin/api/2025-04/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': session.accessToken,
            },
            body: JSON.stringify({ query })
        });

        const json = await response.json();
        console.log("Operation Info:", JSON.stringify(json.data?.node, null, 2));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
