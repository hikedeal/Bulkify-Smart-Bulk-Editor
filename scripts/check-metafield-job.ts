import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkLatestMetafieldJob() {
    const job = await prisma.priceJob.findFirst({
        where: {
            configuration: {
                path: ['fieldToEdit'],
                equals: 'metafield'
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (!job) {
        console.log("No metafield jobs found");
        return;
    }

    console.log("=== LATEST METAFIELD JOB ===");
    console.log("Job ID:", job.jobId);
    console.log("Status:", job.status);
    console.log("Created:", job.createdAt);
    console.log("Completed:", job.completedAt);

    const config = job.configuration as any;
    console.log("\nConfiguration:");
    console.log("  Namespace:", config.metafieldNamespace);
    console.log("  Key:", config.metafieldKey);
    console.log("  Target Type:", config.metafieldTargetType);
    console.log("  Edit Method:", config.editMethod);
    console.log("  Edit Value:", config.editValue);

    console.log("\nJob Stats:");
    console.log("  Total Products:", job.totalProducts);
    console.log("  Products Changed:", job.productsChanged);
    console.log("  Note:", job.note);

    // Check if there's a bulk operation ID in the note
    if (job.note?.includes("BULK_OP_ID:")) {
        const bulkOpId = job.note.match(/BULK_OP_ID:([^\s]+)/)?.[1];
        console.log("\n⚠️  This job used Bulk API");
        console.log("  Bulk Operation ID:", bulkOpId);
        console.log("  Check if bulk operation completed successfully");
    }
}

checkLatestMetafieldJob().catch(console.error).finally(() => prisma.$disconnect());
