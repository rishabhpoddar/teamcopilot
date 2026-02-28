import dotenv from 'dotenv';
dotenv.config();
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from './prisma/client';

type UserRole = 'User' | 'Engineer';

type ChangeUserRoleArgs = {
    email: string;
    role: UserRole;
};

type PartialChangeUserRoleArgs = Partial<ChangeUserRoleArgs>;

function parseArgs(argv: string[]): PartialChangeUserRoleArgs {
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
    const roleRaw = flags.get('role')?.trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address. Pass --email user@example.com');
    }
    if (roleRaw !== undefined && roleRaw !== 'User' && roleRaw !== 'Engineer') {
        throw new Error('Role must be User or Engineer. Pass --role User|Engineer');
    }

    return {
        email,
        role: roleRaw as UserRole | undefined,
    };
}

async function promptMissingArgs(parsedArgs: PartialChangeUserRoleArgs): Promise<ChangeUserRoleArgs> {
    const rl = createInterface({ input, output });
    try {
        const email = parsedArgs.email ?? await promptValidated(rl, 'Enter email: ', (value) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address. Please try again.'
        );

        const role = parsedArgs.role ?? await promptValidated(rl, 'Enter role (User/Engineer): ', (value) =>
            value === 'User' || value === 'Engineer' ? null : 'Role must be User or Engineer. Please try again.'
        ) as UserRole;

        return { email, role };
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

    await prisma.users.update({
        where: { email: args.email },
        data: { role: args.role }
    });

    console.log(`Updated role for ${args.email} to ${args.role}.`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
