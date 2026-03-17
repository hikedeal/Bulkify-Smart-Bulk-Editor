import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkBulkOp() {
    const shopDomain = "hikedeal-2.myshopify.com";
    const session = await prisma.session.findFirst({
        where: {
            shop: shopDomain,
            isOnline: false
        }
    });

    if (!session || !session.accessToken) {
        console.error("No offline session found");
        return;
    }

    const bulkOpId = "gid://shopify/BulkOperation/5036403261497";

    const response = await fetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken
        },
        body: JSON.stringify({
            query: `
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
            `
        })
    });

    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
}

checkBulkOp()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
