import { randomUUID } from "crypto";
import prisma from "../prisma/client";
import { getResourceAccessSummary } from "./resource-access";
import { getWorkflowSnapshotApprovalState } from "./workflow-approval-snapshot";
import { readWorkflowManifestAndEnsurePermissions } from "./workflow";

type WorkflowApiKey = {
    id: string;
    workflow_slug: string;
    api_key: string;
    created_by_user_id: string;
    created_at: bigint;
};

export async function assertCanManageWorkflowApiKeys(slug: string, userId: string): Promise<void> {
    await readWorkflowManifestAndEnsurePermissions(slug);
    const approvalState = await getWorkflowSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: "Workflow must be approved before managing API keys"
        };
    }

    const access = await getResourceAccessSummary("workflow", slug, userId);
    if (!access.can_edit) {
        throw {
            status: 403,
            message: "You do not have permission to manage API keys for this workflow"
        };
    }
}

async function ensureWorkflowApiKey(slug: string, createdByUserId: string): Promise<WorkflowApiKey> {
    const existing = await prisma.workflow_api_keys.findFirst({
        where: { workflow_slug: slug },
        orderBy: { created_at: "asc" }
    });
    if (existing) {
        return existing;
    }

    return await prisma.workflow_api_keys.create({
        data: {
            workflow_slug: slug,
            api_key: randomUUID(),
            created_by_user_id: createdByUserId,
            created_at: BigInt(Date.now()),
        }
    });
}

export async function listWorkflowApiKeys(slug: string, createdByUserId: string): Promise<WorkflowApiKey[]> {
    await ensureWorkflowApiKey(slug, createdByUserId);
    return await prisma.workflow_api_keys.findMany({
        where: { workflow_slug: slug },
        orderBy: { created_at: "asc" }
    });
}

export async function createWorkflowApiKey(slug: string, createdByUserId: string): Promise<WorkflowApiKey> {
    return await prisma.workflow_api_keys.create({
        data: {
            workflow_slug: slug,
            api_key: randomUUID(),
            created_by_user_id: createdByUserId,
            created_at: BigInt(Date.now()),
        }
    });
}

export async function deleteWorkflowApiKey(slug: string, keyId: string): Promise<void> {
    const key = await prisma.workflow_api_keys.findUnique({
        where: { id: keyId }
    });
    if (!key || key.workflow_slug !== slug) {
        throw {
            status: 404,
            message: "Workflow API key not found"
        };
    }

    const keyCount = await prisma.workflow_api_keys.count({
        where: { workflow_slug: slug }
    });
    if (keyCount <= 1) {
        throw {
            status: 400,
            message: "Each workflow must always have at least one API key"
        };
    }

    await prisma.workflow_api_keys.delete({
        where: { id: keyId }
    });
}
