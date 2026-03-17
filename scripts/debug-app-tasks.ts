
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Checking last 20 tasks...");

    const stuckJobs = await prisma.priceJob.findMany({
        orderBy: {
            createdAt: 'desc'
        },
        take: 20
    });

    if (stuckJobs.length === 0) {
        console.log("No jobs found!");
    } else {
        for (const job of stuckJobs) {
            console.log(`[${job.shopDomain}] Job ${job.jobId} (${job.name})`);
            console.log(`  Status: ${job.status}`);
            console.log(`  Created: ${job.createdAt}`);
            if (job.error) {
                console.log(`  ERROR: ${job.error}`);
            }
            console.log("---");
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
