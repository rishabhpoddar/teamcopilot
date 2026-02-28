import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from './prisma/client';
import { assertEnv } from './utils/assert';

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

async function main() {
    const email = await resolveEmailArgOrPrompt();

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
        console.error(`No user found with email: ${email}`);
        process.exit(1);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    await prisma.users.update({
        where: { id: user.id },
        data: { reset_token: resetToken, reset_token_expires_at: expiresAt }
    });

    const serviceUrl = assertEnv('EXTERNAL_SERVICE_URL');
    console.log(`\nPassword reset link (expires in 1 hour):\n${serviceUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}\n`);

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
