import { ensureWorkspaceDatabase, ensureWorkspaceDatabaseDirectory, workspaceDatabaseExists } from "./workspace-sync";
import { loadJwtSecret } from "./jwt-secret";

let didBootstrapCliDatabaseAccess = false;
let didBootstrapCliJwtAccess = false;

export async function bootstrapCliDatabaseAccess(): Promise<void> {
    if (didBootstrapCliDatabaseAccess) {
        return;
    }

    ensureWorkspaceDatabaseDirectory();
    if (!workspaceDatabaseExists()) {
        await ensureWorkspaceDatabase();
    }
    didBootstrapCliDatabaseAccess = true;
}

export async function bootstrapCliJwtAccess(): Promise<void> {
    if (didBootstrapCliJwtAccess) {
        return;
    }

    await bootstrapCliDatabaseAccess();
    await loadJwtSecret();
    didBootstrapCliJwtAccess = true;
}
