import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import prisma from "../prisma/client";
import { SkillSummary } from "../types/skill";
import { apiHandler } from "../utils/index";
import { createSkill, deleteSkill, getOrCreateSkillMetadataAndEnsurePermission, listSkillSlugs, readSkillManifestAndEnsurePermissions } from "../utils/skill";
import {
    getSkillAccessPermissionWithUsers,
    setSkillAccessPermissions,
    addApproverToSkillAccessPermissionsIfRestricted,
} from "../utils/skill-permissions";
import { assertCommonPermissionMode } from "../utils/permission-common";
import {
    createSkillFileOrFolder,
    deleteSkillPath,
    listSkillDirectory,
    readSkillFileContent,
    renameSkillPath,
    saveSkillFileContent,
    uploadSkillFileFromTempPath,
} from "../utils/skill-files";
import { EditorAccessResponse } from "../types/workflow-files";
import { registerResourceFileRoutes } from "../utils/resource-file-routes";
import {
    approveSkillWithSnapshot,
    buildSkillApprovalDiffResponse,
    collectCurrentSkillSnapshot,
    getSkillSnapshotApprovalState,
    loadApprovedSkillSnapshotFromDb,
    restoreSkillToApprovedSnapshot,
} from "../utils/skill-approval-snapshot";
import { getResourceAccessSummary } from "../utils/resource-access";
import { resolveSecretsForUser } from "../utils/secrets";
import { validateSkillSecretContract } from "../utils/secret-contract-validation";

const router = express.Router({ mergeParams: true });
const uploadTmpDir = path.join(os.tmpdir(), "teamcopilot-skill-uploads");
fs.mkdirSync(uploadTmpDir, { recursive: true });
const skillFileUpload = multer({ dest: uploadTmpDir, limits: { files: 1 } });

function normalizeSkillNameOrSlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

async function getSkillEditorAccess(slug: string, userId: string): Promise<EditorAccessResponse> {
    const accessSummary = await getResourceAccessSummary("skill", slug, userId);
    const skillStatus = accessSummary.is_approved ? "approved" : "pending";

    return {
        can_view: accessSummary.can_view,
        can_edit: accessSummary.can_edit,
        editor_status: skillStatus,
    };
}

async function assertCanViewSkillFiles(slug: string, userId: string): Promise<void> {
    const access = await getSkillEditorAccess(slug, userId);
    if (!access.can_view) {
        throw {
            status: 403,
            message: "You do not have permission to view this skill"
        };
    }
}

async function assertCanEditSkillFiles(slug: string, userId: string): Promise<void> {
    const access = await getSkillEditorAccess(slug, userId);
    if (!access.can_edit) {
        throw {
            status: 403,
            message: "You do not have permission to edit this skill"
        };
    }
}

router.post("/", apiHandler(async (req, res) => {
    const body = req.body as {
        name?: unknown;
    };
    const rawName = typeof body.name === "string" ? body.name : "";
    const normalizedName = normalizeSkillNameOrSlug(rawName);
    const unifiedName = normalizedName;

    if (!unifiedName) {
        throw {
            status: 400,
            message: "name is required"
        };
    }

    await createSkill({
        slug: unifiedName,
        createdByUserId: req.userId!,
    });

    res.status(201).json({ success: true });
}, true));

router.get("/", apiHandler(async (req, res) => {
    const slugs = listSkillSlugs();
    const skills: SkillSummary[] = [];
    const creatorIds = new Set<string>();

    const metadataBySlug = new Map<string, Awaited<ReturnType<typeof getOrCreateSkillMetadataAndEnsurePermission>>>();
    for (const slug of slugs) {
        const metadata = await getOrCreateSkillMetadataAndEnsurePermission(slug);
        metadataBySlug.set(slug, metadata);
        if (metadata.created_by_user_id) {
            creatorIds.add(metadata.created_by_user_id);
        }
    }

    const creators = creatorIds.size > 0
        ? await prisma.users.findMany({
            where: {
                id: { in: Array.from(creatorIds) }
            },
            select: {
                id: true,
                name: true,
                email: true,
            }
        })
        : [];
    const creatorNameById = new Map(creators.map((creator) => [creator.id, creator.name]));
    const creatorEmailById = new Map(creators.map((creator) => [creator.id, creator.email]));

    for (const slug of slugs) {
        const metadata = metadataBySlug.get(slug);
        if (!metadata) continue;
        const { manifest } = await readSkillManifestAndEnsurePermissions(slug);
        const accessSummary = await getResourceAccessSummary("skill", slug, req.userId!);
        if (!accessSummary.can_view) {
            continue;
        }
        const createdByUserId = metadata.created_by_user_id;
        skills.push({
            slug,
            name: manifest.name,
            description: manifest.description,
            created_by_user_id: createdByUserId,
            created_by_user_name: createdByUserId ? (creatorNameById.get(createdByUserId) ?? null) : null,
            created_by_user_email: createdByUserId ? (creatorEmailById.get(createdByUserId) ?? null) : null,
            approved_by_user_id: metadata.approved_by_user_id,
            is_approved: accessSummary.is_approved,
            can_view: accessSummary.can_view,
            can_edit: accessSummary.can_edit,
            permission_mode: accessSummary.permission_mode,
            is_locked_due_to_missing_users: accessSummary.is_locked_due_to_missing_users,
            required_secrets: manifest.required_secrets,
            missing_required_secrets: (await resolveSecretsForUser(req.userId!, manifest.required_secrets)).missingKeys,
        });
    }

    res.json({ skills });
}, true));

router.get("/:slug", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanViewSkillFiles(slug, req.userId!);
    const { metadata, manifest } = await readSkillManifestAndEnsurePermissions(slug);

    const createdByUserId = metadata.created_by_user_id ?? null;
    const approvedByUserId = metadata.approved_by_user_id ?? null;
    const userIds = [createdByUserId, approvedByUserId].filter((id): id is string => typeof id === "string");
    const users = userIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true }
        })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const creator = createdByUserId ? (usersById.get(createdByUserId) ?? null) : null;
    const approver = approvedByUserId ? (usersById.get(approvedByUserId) ?? null) : null;
    const accessSummary = await getResourceAccessSummary("skill", slug, req.userId!);
    const permission = await getSkillAccessPermissionWithUsers(slug);
    const secretResolution = await resolveSecretsForUser(req.userId!, manifest.required_secrets);
    const permissionMode = assertCommonPermissionMode(permission.permission_mode, "skill access");
    const permissions = permissionMode === "everyone"
        ? { mode: "everyone" as const }
        : { mode: "restricted" as const, allowed_user_ids: permission.allowedUsers.map((row) => row.user_id) };

    res.json({
        skill: {
            slug,
            name: manifest.name,
            created_by_user_id: createdByUserId,
            created_by_user_name: creator?.name ?? null,
            created_by_user_email: creator?.email ?? null,
            approved_by_user_id: approvedByUserId,
            is_approved: accessSummary.is_approved,
            approved_by_user_name: approver?.name ?? null,
            approved_by_user_email: approver?.email ?? null,
            can_view: accessSummary.can_view,
            can_edit: accessSummary.can_edit,
            permission_mode: accessSummary.permission_mode,
            is_locked_due_to_missing_users: accessSummary.is_locked_due_to_missing_users,
            required_secrets: manifest.required_secrets,
            missing_required_secrets: secretResolution.missingKeys,
            permissions,
            allowed_users_resolved: permission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            })),
        }
    });
}, true));

router.get("/:slug/runtime-content", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanViewSkillFiles(slug, req.userId!);
    const { manifest } = await readSkillManifestAndEnsurePermissions(slug);
    const accessSummary = await getResourceAccessSummary("skill", slug, req.userId!);
    if (!accessSummary.is_approved) {
        throw {
            status: 403,
            message: `Skill "${slug}" is not approved yet. Only approved skills can be read through getSkillContent.`
        };
    }
    const skillContent = await readSkillFileContent(slug, "SKILL.md");

    if (skillContent.kind !== "text") {
        throw {
            status: 500,
            message: "SKILL.md must be a text file"
        };
    }
    validateSkillSecretContract(skillContent.content ?? "");

    const secretResolution = await resolveSecretsForUser(req.userId!, manifest.required_secrets);
    if (secretResolution.missingKeys.length > 0) {
        throw {
            status: 400,
            message: `I can't use skill "${slug}" because these required secrets are missing: ${secretResolution.missingKeys.join(", ")}. Ask the user to add these keys in TeamCopilot Profile Secrets before using this skill.`
        };
    }

    res.json({
        skill: {
            slug,
            path: skillContent.path,
            content: skillContent.content ?? "",
        }
    });
}, true));

router.post("/:slug/approve", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;

    const approvalResult = await approveSkillWithSnapshot(slug, req.userId!);
    const { metadata: approvedMetadata } = await readSkillManifestAndEnsurePermissions(slug);
    await addApproverToSkillAccessPermissionsIfRestricted(slug, req.userId!, approvedMetadata.created_by_user_id);

    res.json({
        skill: {
            slug,
            approved_by_user_id: approvalResult.approved_by_user_id,
            is_approved: true,
            snapshot_hash: approvalResult.snapshot_hash,
            snapshot_file_count: approvalResult.snapshot_file_count
        }
    });
}, true));

router.post("/:slug/reject-restore", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const result = await restoreSkillToApprovedSnapshot(slug, req.userId!);
    res.json({
        skill: {
            slug,
            restored_file_count: result.restored_file_count,
            snapshot_hash: result.snapshot_hash,
        }
    });
}, true));

router.get("/:slug/approval-diff", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;

    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only Engineers can review approval diffs"
        };
    }

    await readSkillManifestAndEnsurePermissions(slug);
    const previousSnapshot = await loadApprovedSkillSnapshotFromDb(slug);
    const currentSnapshot = collectCurrentSkillSnapshot(slug);
    const diff = buildSkillApprovalDiffResponse(previousSnapshot, currentSnapshot);
    res.json(diff);
}, true));

registerResourceFileRoutes({
    router,
    uploadMiddleware: skillFileUpload.single("file"),
    assertCanView: assertCanViewSkillFiles,
    ensureResourceExists: async (slug: string) => {
        await readSkillManifestAndEnsurePermissions(slug);
    },
    getEditorAccess: getSkillEditorAccess,
    assertCanEdit: assertCanEditSkillFiles,
    listDirectory: listSkillDirectory,
    readFileContent: readSkillFileContent,
    saveFileContent: saveSkillFileContent,
    createFileOrFolder: createSkillFileOrFolder,
    uploadFileFromTempPath: uploadSkillFileFromTempPath,
    renamePath: renameSkillPath,
    deletePath: deleteSkillPath,
});

const updateSkillPermissionsHandler = apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const metadata = await getOrCreateSkillMetadataAndEnsurePermission(slug);
    const approvalState = await getSkillSnapshotApprovalState(slug);
    if (!approvalState.is_current_code_approved) {
        throw {
            status: 403,
            message: "Skill must be approved before updating access permissions"
        };
    }

    const currentSummary = await getResourceAccessSummary("skill", slug, req.userId!);
    if (!currentSummary.can_edit) {
        throw {
            status: 403,
            message: currentSummary.is_locked_due_to_missing_users
                ? "Skill permissions cannot be modified because no allowed users remain"
                : "You do not have permission to modify skill access permissions"
        };
    }

    const { mode, allowed_user_ids } = req.body as { mode?: string; allowed_user_ids?: unknown };
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 400,
            message: 'mode must be "restricted" or "everyone"'
        };
    }

    const updatedPermission = mode === "everyone"
        ? await setSkillAccessPermissions(slug, { mode: "everyone" }, metadata.created_by_user_id)
        : await setSkillAccessPermissions(slug, {
            mode: "restricted",
            allowed_user_ids: Array.isArray(allowed_user_ids) ? allowed_user_ids.map((id) => String(id)) : []
        }, metadata.created_by_user_id);
    const updatedSummary = await getResourceAccessSummary("skill", slug, req.userId!);
    const updatedPermissionMode = assertCommonPermissionMode(updatedPermission.permission_mode, "skill access");
    const permissions = updatedPermissionMode === "everyone"
        ? { mode: "everyone" as const }
        : { mode: "restricted" as const, allowed_user_ids: updatedPermission.allowedUsers.map((row) => row.user_id) };
    res.json({
        skill: {
            slug,
            ...updatedSummary,
            permissions,
            allowed_users_resolved: updatedPermission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            }))
        }
    });
}, true);

// PATCH /api/skills/:slug/permissions - Update permissions (canonical)
router.patch("/:slug/permissions", updateSkillPermissionsHandler);

router.delete("/:slug", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const metadata = await getOrCreateSkillMetadataAndEnsurePermission(slug);
    const creatorUserId = metadata.created_by_user_id ?? null;

    const creator = creatorUserId
        ? await prisma.users.findUnique({
            where: { id: creatorUserId },
            select: { id: true }
        })
        : null;

    const isOwner = creatorUserId === req.userId!;
    const hasNoCreatorUser = creator === null;
    const isEngineer = req.role === "Engineer";

    if (!isOwner && !(hasNoCreatorUser && isEngineer)) {
        throw {
            status: 403,
            message: "Only the skill owner can delete this skill. Engineers can only delete skills whose owner no longer exists."
        };
    }

    await deleteSkill(slug);

    res.json({ success: true });
}, true));

export default router;
