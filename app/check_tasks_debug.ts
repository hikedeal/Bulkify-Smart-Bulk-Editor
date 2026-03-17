
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkTasks() {
    const shop = 'hikedeal-2.myshopify.com';
    const tasks = await prisma.priceJob.findMany({
        where: { shopDomain: shop },
        select: {
            jobId: true,
            name: true,
            status: true,
            revertStatus: true,
            createdAt: true
        }
    });
    console.log("Tasks for", shop, ":", JSON.stringify(tasks, null, 2));
}

checkTasks().catch(console.error).finally(() => prisma.$disconnect());
