import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkMetafieldRevert() {
    // Get the most recent metafield revert
    const job = await prisma.priceJob.findFirst({
        where: {
            revertStatus: { in: ["reverted", "reverting"] },
            configuration: {
                path: ['fieldToEdit'],
                equals: 'metafield'
            }
        },
        orderBy: { revertedAt: 'desc' }
    });

    if (!job) {
        console.log("No metafield revert jobs found");
        return;
    }

    console.log("=== LATEST METAFIELD REVERT ===");
    console.log("Job ID:", job.jobId);
    console.log("Revert Status:", job.revertStatus);
    console.log("Reverted At:", job.revertedAt);

    const config = job.configuration as any;
    console.log("\nConfiguration:");
    console.log("  Namespace:", config.metafieldNamespace);
    console.log("  Key:", config.metafieldKey);
    console.log("  Target Type:", config.metafieldTargetType);

    console.log("\n=== ORIGINAL DATA (first 3 items) ===");
    const originalData = job.originalData as any;
    const metafieldKeys = Object.keys(originalData).filter(k =>
        originalData[k].metafield !== undefined
    ).slice(0, 3);

    metafieldKeys.forEach(k => {
        console.log(`\n${k}:`);
        console.log("  Metafield data:", JSON.stringify(originalData[k].metafield, null, 2));
    });
}

checkMetafieldRevert().catch(console.error).finally(() => prisma.$disconnect());
