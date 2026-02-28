import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from './prisma/client';
import { getPasswordPolicyErrorMessage, isPasswordValid, MIN_PASSWORD_LENGTH } from './utils/password-policy';

type UserRole = 'User' | 'Engineer';

type CreateUserArgs = {
    email: string;
    name: string;
    role: UserRole;
    password: string;
};

type PartialCreateUserArgs = Partial<CreateUserArgs>;

function parseArgs(argv: string[]): PartialCreateUserArgs {
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
    const name = flags.get('name')?.trim();
    const roleRaw = flags.get('role')?.trim();
    const password = flags.get('password');

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address. Pass --email user@example.com');
    }
    if (name !== undefined && name.length === 0) {
        throw new Error('Name cannot be empty. Pass --name "Full Name"');
    }
    if (roleRaw !== undefined && roleRaw !== 'User' && roleRaw !== 'Engineer') {
        throw new Error('Role must be User or Engineer. Pass --role User|Engineer');
    }
    if (password !== undefined && !isPasswordValid(password)) {
        throw new Error(`${getPasswordPolicyErrorMessage()}. Pass --password <temp-password>`);
    }

    return {
        email,
        name,
        role: roleRaw as UserRole | undefined,
        password
    };
}

async function promptMissingArgs(parsedArgs: PartialCreateUserArgs): Promise<CreateUserArgs> {
    const rl = createInterface({ input, output });
    try {
        const email = parsedArgs.email ?? await promptValidated(rl, 'Enter email: ', (value) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address. Please try again.'
        );

        const name = parsedArgs.name ?? await promptValidated(rl, 'Enter name: ', (value) =>
            value.length > 0 ? null : 'Name cannot be empty. Please try again.'
        );

        const role = parsedArgs.role ?? await promptValidated(rl, 'Enter role (User/Engineer): ', (value) =>
            value === 'User' || value === 'Engineer' ? null : 'Role must be User or Engineer. Please try again.'
        ) as UserRole;

        const password = parsedArgs.password ?? await promptValidated(rl, `Enter temporary password (min ${MIN_PASSWORD_LENGTH} chars): `, (value) =>
            isPasswordValid(value) ? null : `${getPasswordPolicyErrorMessage()}. Please try again.`
        );

        return { email, name, role, password };
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
    if (existing) {
        throw new Error(`An account with this email already exists: ${args.email}`);
    }

    const passwordHash = await bcrypt.hash(args.password, 12);
    await prisma.users.create({
        data: {
            email: args.email,
            name: args.name,
            role: args.role,
            created_at: Date.now(),
            password_hash: passwordHash,
            must_change_password: true
        }
    });

    console.log(`Created user ${args.email} (${args.role}). Password change is required on first sign in.`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
