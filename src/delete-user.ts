import dotenv from 'dotenv';
dotenv.config();
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from './prisma/client';

type DeleteUserArgs = {
    email: string;
};

type PartialDeleteUserArgs = Partial<DeleteUserArgs>;

function parseArgs(argv: string[]): PartialDeleteUserArgs {
    const flags = new Map<string, string>();

    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (!key.startsWith('--')) {
            continue;
        }
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`);
        }
        flags.set(key.slice(2), value);
        i += 1;
    }

    const email = flags.get('email')?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address. Pass --email user@example.com');
    }

    return { email };
}

async function promptMissingArgs(parsedArgs: PartialDeleteUserArgs): Promise<DeleteUserArgs> {
    const rl = createInterface({ input, output });
    try {
        const email = parsedArgs.email ?? await promptValidated(rl, 'Enter email to delete: ', (value) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address. Please try again.'
        );
        return { email };
    } finally {
        rl.close();
    }
}

async function promptValidated(
    rl: ReturnType<typeof createInterface>,
    prompt: string,
    validator: (value: string) => string | null
): Promise<string> {
    while (true) {
        const answer = (await rl.question(prompt)).trim();
        const error = validator(answer);
        if (!error) return answer;
        console.error(error);
    }
}

async function main() {
    const parsedArgs = parseArgs(process.argv.slice(2));
    const args = await promptMissingArgs(parsedArgs);

    const existing = await prisma.users.findUnique({ where: { email: args.email } });
    if (!existing) {
        throw new Error(`No user found with email: ${args.email}`);
    }

    await prisma.users.delete({ where: { email: args.email } });

    console.log(`Deleted user ${args.email}.`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
