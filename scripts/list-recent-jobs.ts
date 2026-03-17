import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listRecentJobs() {
    const jobs = await prisma.priceJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    console.log("Recent Jobs:");
    for (const job of jobs) {
        console.log(`--------------------------------------------------`);
        console.log(`ID: ${job.jobId}`);
        console.log(`Name: ${job.name}`);
        console.log(`Status: ${job.status}`);
        console.log(`Created: ${job.createdAt}`);
        console.log(`Updated: ${job.updatedAt}`);
        console.log(`Note: ${job.note}`);
        console.log(`Error: ${job.error}`);
    }
}

listRecentJobs()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
