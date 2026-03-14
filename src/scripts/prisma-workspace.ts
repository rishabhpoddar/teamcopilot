import dotenv from "dotenv";
import { spawn } from "child_process";
import { getWorkspaceDatabaseUrl } from "../utils/workspace-sync";
import { getPackageRoot, getPrismaSchemaPath } from "../utils/runtime-paths";

dotenv.config();

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: npm run prisma -- <prisma args>");
    process.exit(1);
}

const databaseUrl = getWorkspaceDatabaseUrl();
const prismaCliEntrypoint = require.resolve("prisma/build/index.js", {
    paths: [getPackageRoot()],
});
const child = spawn(process.execPath, [prismaCliEntrypoint, ...args, "--schema", getPrismaSchemaPath()], {
    cwd: getPackageRoot(),
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
