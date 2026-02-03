import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
    transactionOptions: {
        timeout: 60_000, // 60 sec
        maxWait: 60_000  // 60 sec
    },
});

// Enable WAL mode for better SQLite concurrency (allows reads during writes)
prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});

export default prisma;