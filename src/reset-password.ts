import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import prisma from './prisma/client';
import { assertEnv } from './utils/assert';

async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: npm run reset-password -- <email>');
        process.exit(1);
    }

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
    console.log(`\nPassword reset link (expires in 1 hour):\n${serviceUrl}/reset-password?token=${resetToken}\n`);

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
