import dotenv from 'dotenv';
dotenv.config();
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import prisma from './prisma/client';
import { getPasswordPolicyErrorMessage, isPasswordValid, MIN_PASSWORD_LENGTH } from './utils/password-policy';
import { bootstrapCliDatabaseAccess } from './utils/cli-bootstrap';

async function resolveEmailArgOrPrompt(): Promise<string> {
    const argEmail = process.argv[2];
    if (argEmail && argEmail.trim().length > 0) {
        return argEmail.trim();
    }

    const rl = createInterface({ input, output });
    try {
        while (true) {
            const answer = (await rl.question('Enter email: ')).trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) {
                return answer;
            }
            console.error('Invalid email address. Please try again.');
        }
    } finally {
        rl.close();
    }
}

async function resolveTempPasswordOrPrompt(): Promise<string> {
    const rl = createInterface({ input, output });
    try {
        while (true) {
            const answer = (await rl.question(`Enter temporary password (min ${MIN_PASSWORD_LENGTH} chars): `)).trim();
            if (isPasswordValid(answer)) {
                return answer;
            }
            console.error(`${getPasswordPolicyErrorMessage()}. Please try again.`);
        }
    } finally {
        rl.close();
    }
}

async function main() {
    await bootstrapCliDatabaseAccess();
    const email = await resolveEmailArgOrPrompt();
    const tempPassword = await resolveTempPasswordOrPrompt();

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
        console.error(`No user found with email: ${email}`);
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await prisma.users.update({
        where: { id: user.id },
        data: {
            password_hash: passwordHash,
            must_change_password: true,
            reset_token: null,
            reset_token_expires_at: null
        }
    });

    console.log(`Temporary password set for ${user.email}. Password change is required on next sign in.`);

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
