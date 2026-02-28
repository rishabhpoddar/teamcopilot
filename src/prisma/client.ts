import { PrismaClient } from '@prisma/client'
import { getWorkspaceDatabaseUrl } from '../utils/workspace-sync';

const prisma = new PrismaClient({
    datasourceUrl: getWorkspaceDatabaseUrl(),
    transactionOptions: {
        timeout: 60_000, // 60 sec
        maxWait: 60_000  // 60 sec
    },
});

// Enable WAL mode for better SQLite concurrency (allows reads during writes)
prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});

export default prisma;
