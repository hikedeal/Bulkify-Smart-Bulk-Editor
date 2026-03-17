
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Checking for stale 'calculating' jobs...");

    // Find jobs that are calculating and older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const stuckJobs = await prisma.priceJob.updateMany({
        where: {
            status: "calculating",
            createdAt: {
                lt: oneHourAgo
            }
        },
        data: {
            status: "failed",
            error: "Task timed out (stuck in calculating state)"
        }
    });

    console.log(`Updated ${stuckJobs.count} stuck jobs to 'failed'.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
