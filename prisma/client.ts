import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
    transactionOptions: {
        timeout: 60_000, // 60 sec
        maxWait: 60_000  // 60 sec
    },
});

export default prisma;