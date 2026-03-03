import fs from "fs";
import path from "path";
import prisma from "../prisma/client";
import { getWorkspaceDirFromEnv } from "./workspace-sync";

export interface SkillManifest {
    name: string;
    description: string;
}

export interface SkillMetadata {
    skill_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    access_permission_mode: "restricted" | "everyone";
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

export function getSkillTemplatePath(slug: string): string {
    return path.join(getSkillPath(slug), "skills.md");
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
        const templateManifestPath = path.join(skillsDir, entry.name, "skills.md");
        if (fs.existsSync(canonicalManifestPath) || fs.existsSync(templateManifestPath)) {
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
    const canonicalManifestPath = getSkillManifestPath(slug);
    const templateManifestPath = getSkillTemplatePath(slug);
    const skillManifestPath = fs.existsSync(canonicalManifestPath) ? canonicalManifestPath : templateManifestPath;
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

    const existingMetadata = await prisma.skill_metadata.findUnique({
        where: { skill_slug: slug },
        select: { skill_slug: true }
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
    const skillMdPath = getSkillTemplatePath(slug);
    const body = `---\nname: ${toSkillFrontmatterValue(name)}\ndescription: ${toSkillFrontmatterValue("")}\n---\n\n# ${name}\n\nDescribe what this skill does.\n\n## Instructions\n\nAdd detailed, actionable instructions for the agent here.\n`;
    fs.writeFileSync(skillMdPath, body, "utf-8");

    const now = BigInt(Date.now());
    await prisma.$transaction(async (tx) => {
        await tx.skill_metadata.create({
            data: {
                skill_slug: slug,
                created_by_user_id: input.createdByUserId,
                approved_by_user_id: null,
                access_permission_mode: "restricted",
                created_at: now,
                updated_at: now,
            }
        });

        await tx.skill_access_permission_users.create({
            data: {
                skill_slug: slug,
                user_id: input.createdByUserId,
                created_at: now,
            }
        });
    });
}

function mapSkillMetadataRow(row: {
    skill_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    access_permission_mode: string;
}): SkillMetadata {
    if (row.access_permission_mode !== "restricted" && row.access_permission_mode !== "everyone") {
        throw {
            status: 500,
            message: `Invalid skill access permission mode: ${row.access_permission_mode}`
        };
    }

    return {
        skill_slug: row.skill_slug,
        created_by_user_id: row.created_by_user_id,
        approved_by_user_id: row.approved_by_user_id,
        access_permission_mode: row.access_permission_mode,
    };
}

export async function getOrCreateSkillMetadata(slug: string): Promise<SkillMetadata> {
    readSkillManifest(slug);

    const existing = await prisma.skill_metadata.findUnique({
        where: { skill_slug: slug }
    });
    if (existing) {
        return mapSkillMetadataRow(existing);
    }

    const now = BigInt(Date.now());
    const created = await prisma.skill_metadata.create({
        data: {
            skill_slug: slug,
            access_permission_mode: "restricted",
            created_at: now,
            updated_at: now,
        }
    });

    return mapSkillMetadataRow(created);
}
