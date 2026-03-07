import crypto from "node:crypto";
import prisma from "../prisma/client";
import { assertCondition } from "./assert";

const AUTH_TOKEN_SECRET_KEY = "jwt_secret";

let cachedJwtSecret: string | null = null;

function generateJwtSecret(): string {
    return crypto.randomBytes(48).toString("hex");
}

async function ensureJwtSecret(): Promise<string> {
    const existing = await prisma.key_value.findUnique({
        where: { key: AUTH_TOKEN_SECRET_KEY }
    });

    if (existing?.value) {
        cachedJwtSecret = existing.value;
        return existing.value;
    }

    const generated = generateJwtSecret();
    try {
        await prisma.key_value.create({
            data: {
                key: AUTH_TOKEN_SECRET_KEY,
                value: generated
            }
        });
        cachedJwtSecret = generated;
        return generated;
    } catch (err) {
        const fallback = await prisma.key_value.findUnique({
            where: { key: AUTH_TOKEN_SECRET_KEY }
        });
        if (fallback?.value) {
            cachedJwtSecret = fallback.value;
            return fallback.value;
        }
        throw err;
    }
}

export async function loadJwtSecret(): Promise<void> {
    await ensureJwtSecret();
}

export function getJwtSecret(): string {
    assertCondition(
        typeof cachedJwtSecret === "string" && cachedJwtSecret.length > 0,
        "JWT secret not initialized"
    );
    return cachedJwtSecret;
}

export async function rotateJwtSecret(): Promise<string> {
    const nextSecret = generateJwtSecret();
    await prisma.key_value.upsert({
        where: { key: AUTH_TOKEN_SECRET_KEY },
        create: { key: AUTH_TOKEN_SECRET_KEY, value: nextSecret },
        update: { value: nextSecret }
    });
    cachedJwtSecret = nextSecret;
    return nextSecret;
}
