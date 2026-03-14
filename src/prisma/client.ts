import { PrismaClient } from '../../prisma/generated/client'
import { getWorkspaceDatabaseUrl } from '../utils/workspace-sync';

let prismaClient: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
    const client = new PrismaClient({
        datasourceUrl: getWorkspaceDatabaseUrl(),
        transactionOptions: {
            timeout: 60_000, // 60 sec
            maxWait: 60_000  // 60 sec
        },
    });

    // Enable WAL mode for better SQLite concurrency (allows reads during writes)
    client.$executeRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => { });
    return client;
}

function getPrismaClient(): PrismaClient {
    if (!prismaClient) {
        prismaClient = createPrismaClient();
    }
    return prismaClient;
}

const prisma = new Proxy({} as PrismaClient, {
    get(_target, property, receiver) {
        const client = getPrismaClient();
        const value = Reflect.get(client as unknown as object, property, receiver);
        if (typeof value === "function") {
            return value.bind(client);
        }
        return value;
    },
    set(_target, property, value) {
        const client = getPrismaClient();
        return Reflect.set(client as unknown as object, property, value);
    },
});

export default prisma as PrismaClient;
