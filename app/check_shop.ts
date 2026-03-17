
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkShop() {
    const shop = await prisma.shop.findUnique({
        where: { shop: 'hikedeal-2.myshopify.com' }
    });
    console.log("Shop Record:", JSON.stringify(shop, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));
}

checkShop().catch(console.error).finally(() => prisma.$disconnect());
