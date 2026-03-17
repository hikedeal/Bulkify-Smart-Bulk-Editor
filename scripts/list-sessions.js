import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Listing current sessions...');
    try {
        const sessions = await prisma.session.findMany();

        if (sessions.length === 0) {
            console.log('No sessions found.');
        } else {
            sessions.forEach(session => {
                console.log(`Shop: ${session.shop}`);
                console.log(`  ID: ${session.id}`);
                console.log(`  Scopes: ${session.scope}`);
                console.log(`  Expires: ${session.expires}`);
                console.log('---');
            });
        }
    } catch (error) {
        console.error('Error listing sessions:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
