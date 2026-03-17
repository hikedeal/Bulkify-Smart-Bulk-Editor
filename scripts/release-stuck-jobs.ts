import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function releaseStuckJobs() {
    console.log('Checking for stuck jobs...');

    // Find jobs that have been in 'processing' or 'calculating' state for more than 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const stuckJobs = await prisma.priceJob.findMany({
        where: {
            status: {
                in: ['processing', 'calculating']
            },
            updatedAt: {
                lt: fifteenMinutesAgo
            }
        }
    });

    console.log(`Found ${stuckJobs.length} stuck jobs.`);

    for (const job of stuckJobs) {
        console.log(`Releasing job ${job.jobId} (Status: ${job.status}, Updated: ${job.updatedAt})`);

        // reset job to failed so user can see it failed
        await prisma.priceJob.update({
            where: { jobId: job.jobId },
            data: {
                status: 'failed',
                note: `[System] Job force-failed by release-stuck-jobs script due to inactivity since ${job.updatedAt.toISOString()}`
            }
        });
    }

    console.log('Done.');
}

releaseStuckJobs()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
