import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function inspectJob(jobId: string) {
    const job = await prisma.priceJob.findUnique({
        where: { jobId }
    });

    if (!job) {
        console.log(`Job ${jobId} not found.`);
        return;
    }

    console.log(`Job: ${job.jobId}`);
    console.log(`Status: ${job.status}`);
    console.log(`Field to edit: ${(job.configuration as any)?.fieldToEdit}`);
    console.log(`Configuration:`, JSON.stringify(job.configuration, null, 2));
    console.log(`Error: ${job.error}`);
    console.log(`Processed: ${job.processedProducts} / ${job.totalProducts}`);
}

const jobId = process.argv[2];
if (!jobId) {
    console.error("Please provide a jobId");
    process.exit(1);
}

inspectJob(jobId).catch(console.error);
