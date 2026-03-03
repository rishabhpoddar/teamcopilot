import fs from "fs";
import path from "path";
import prisma from "../prisma/client";
import { getWorkspaceDirFromEnv } from "./workspace-sync";
import { ensureResourcePermissions } from "./permission-common";

export interface SkillManifest {
    name: string;
    description: string;
}

export interface SkillMetadata {
    skill_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
}

export interface CreateSkillInput {
    slug: string;
    name: string;
    createdByUserId: string;
}

function getSkillsRootPath(): string {
    return path.join(getWorkspaceDirFromEnv(), ".custom-skills");
}

export function getSkillPath(slug: string): string {
    return path.join(getSkillsRootPath(), slug);
}

export function deleteSkillDirectory(slug: string): void {
    const skillPath = getSkillPath(slug);

    if (!fs.existsSync(skillPath)) {
        throw {
            status: 404,
            message: `Skill not found for slug: ${slug}`
        };
    }

    fs.rmSync(skillPath, { recursive: true, force: false });
}

export function getSkillManifestPath(slug: string): string {
    return path.join(getSkillPath(slug), "SKILL.md");
}

export function assertSkillSlug(slug: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw {
            status: 400,
            message: "Invalid skill slug. Expected lowercase letters/numbers with optional hyphens."
        };
    }
}

export function listSkillSlugs(): string[] {
    const skillsDir = getSkillsRootPath();
    if (!fs.existsSync(skillsDir)) {
        return [];
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const slugs: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const canonicalManifestPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (fs.existsSync(canonicalManifestPath)) {
            slugs.push(entry.name);
        }
    }

    return slugs;
}

function extractFrontmatterValue(frontmatter: string, key: string): string | null {
    const pattern = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
    const match = frontmatter.match(pattern);
    if (!match) {
        return null;
    }
    return match[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

export function readSkillManifest(slug: string): SkillManifest {
    const skillManifestPath = getSkillManifestPath(slug);
    if (!fs.existsSync(skillManifestPath)) {
        throw {
            status: 404,
            message: `Skill manifest not found for slug: ${slug}`
        };
    }

    const content = fs.readFileSync(skillManifestPath, "utf-8");
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
    const frontmatter = frontmatterMatch?.[1] ?? "";

    const name = extractFrontmatterValue(frontmatter, "name") ?? slug;
    const description = extractFrontmatterValue(frontmatter, "description") ?? "";

    return {
        name,
        description,
    };
}

function toSkillFrontmatterValue(value: string): string {
    return JSON.stringify(value.trim());
}

export async function createSkill(input: CreateSkillInput): Promise<void> {
    const slug = input.slug.trim();
    const name = input.name.trim();

    assertSkillSlug(slug);
    if (!name) {
        throw {
            status: 400,
            message: "Skill name is required"
        };
    }
    if (name !== slug) {
        throw {
            status: 400,
            message: "Skill name and slug must be the same value"
        };
    }

    const existingMetadata = await prisma.resource_metadata.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: "skill",
                resource_slug: slug
            }
        },
        select: { resource_slug: true }
    });
    if (existingMetadata) {
        throw {
            status: 409,
            message: `Skill with slug "${slug}" already exists`
        };
    }

    const skillPath = getSkillPath(slug);
    if (fs.existsSync(skillPath)) {
        throw {
            status: 409,
            message: `Skill with slug "${slug}" already exists`
        };
    }

    fs.mkdirSync(skillPath, { recursive: false });
    const skillMdPath = getSkillManifestPath(slug);
    const body = `---\nname: ${toSkillFrontmatterValue(name)}\ndescription: ${toSkillFrontmatterValue("")}\n---\n\n# ${name}\n\nDescribe what this skill does.\n\n## Instructions\n\nAdd detailed, actionable instructions for the agent here.\n`;
    fs.writeFileSync(skillMdPath, body, "utf-8");

    const now = BigInt(Date.now());
    await prisma.$transaction(async (tx) => {
        await tx.resource_metadata.create({
            data: {
                resource_kind: "skill",
                resource_slug: slug,
                created_by_user_id: input.createdByUserId,
                approved_by_user_id: null,
                created_at: now,
                updated_at: now,
            }
        });

        await tx.resource_permissions.create({
            data: {
                resource_kind: "skill",
                resource_slug: slug,
                permission_mode: "restricted",
                created_at: now,
                updated_at: now,
                allowedUsers: {
                    create: {
                        user_id: input.createdByUserId,
                        created_at: now
                    }
                }
            }
        });
    });
}

export async function getOrCreateSkillMetadataAndEnsurePermission(slug: string): Promise<SkillMetadata> {
    readSkillManifest(slug);

    const existing = await prisma.resource_metadata.findUnique({
        where: {
            resource_kind_resource_slug: {
                resource_kind: "skill",
                resource_slug: slug
            }
        }
    });
    if (existing) {
        const metadata: SkillMetadata = {
            skill_slug: existing.resource_slug,
            created_by_user_id: existing.created_by_user_id,
            approved_by_user_id: existing.approved_by_user_id,
        };
        await ensureResourcePermissions(
            "skill",
            slug,
            [metadata.created_by_user_id, metadata.approved_by_user_id].filter((id): id is string => Boolean(id))
        );
        return metadata;
    }

    const now = BigInt(Date.now());
    const created = await prisma.resource_metadata.create({
        data: {
            resource_kind: "skill",
            resource_slug: slug,
            created_at: now,
            updated_at: now,
        }
    });
    await ensureResourcePermissions("skill", slug, []);
    return {
        skill_slug: created.resource_slug,
        created_by_user_id: created.created_by_user_id,
        approved_by_user_id: created.approved_by_user_id,
    };
}
