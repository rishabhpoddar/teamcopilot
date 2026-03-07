import dotenv from "dotenv";
dotenv.config();
import prisma from "./prisma/client";
import { rotateJwtSecret } from "./utils/jwt-secret";

async function main() {
    await rotateJwtSecret();
    console.log("JWT secret rotated. Existing tokens are now invalid.");
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
