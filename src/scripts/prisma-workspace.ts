import dotenv from "dotenv";
import { spawn } from "child_process";
import { getWorkspaceDatabaseUrl } from "../utils/workspace-sync";

dotenv.config();

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: npm run prisma -- <prisma args>");
    process.exit(1);
}

const databaseUrl = getWorkspaceDatabaseUrl();
const child = spawn("npx", ["prisma", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
    },
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
