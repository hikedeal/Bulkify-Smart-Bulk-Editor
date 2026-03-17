
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLatestTask() {
    try {
        const lastTask = await prisma.priceJob.findFirst({
            orderBy: { createdAt: 'desc' }
        });

        console.log("Latest Task:");
        console.log("ID:", lastTask?.jobId);
        console.log("Name:", lastTask?.name);
        console.log("Total Products (DB):", lastTask?.totalProducts);
        console.log("Configuration:", JSON.stringify(lastTask?.configuration, null, 2));
    } catch (e) {
        console.error("Error fetching task:", e);
    } finally {
        await prisma.$disconnect();
    }
}

checkLatestTask();
