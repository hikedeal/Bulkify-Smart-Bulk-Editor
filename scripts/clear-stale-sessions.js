import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Checking for stale sessions...');
    try {
        const sessions = await prisma.session.findMany();
        let deletedCount = 0;

        for (const session of sessions) {
            const scope = session.scope || '';
            if (!scope.includes('read_markets') || !scope.includes('write_markets')) {
                console.log(`Deleting stale session for shop: ${session.shop} (Scopes: ${scope})`);
                await prisma.session.delete({
                    where: { id: session.id },
                });
                deletedCount++;
            }
        }

        console.log(`Cleared ${deletedCount} stale sessions.`);
    } catch (error) {
        console.error('Error clearing sessions:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
