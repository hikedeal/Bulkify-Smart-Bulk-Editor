
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkJobs() {
    const jobs = await prisma.priceJob.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' }
    });
    console.log("Latest priceJobs:", JSON.stringify(jobs, null, 2));

    const countsByShop = await prisma.priceJob.groupBy({
        by: ['shopDomain'],
        _count: { _all: true }
    });
    console.log("Counts by shop:", JSON.stringify(countsByShop, null, 2));
}

checkJobs().catch(console.error).finally(() => prisma.$disconnect());
