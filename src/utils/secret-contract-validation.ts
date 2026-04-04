import fs from "fs";
import path from "path";
import { normalizeSecretKeyList } from "./secrets";

const PYTHON_SECRET_PATTERNS = [
    /os\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*[\),]/g,
    /environ\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*[\),]/g,
];

const SKILL_SECRET_PLACEHOLDER_PATTERN = /\{\{SECRET:([A-Z][A-Z0-9_]*)\}\}/g;

function uniqueNormalizedKeys(keys: string[]): string[] {
    return normalizeSecretKeyList(keys);
}

function findDuplicateKeys(rawKeys: unknown[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const rawKey of rawKeys) {
        if (typeof rawKey !== "string") {
            continue;
        }
        const normalized = rawKey.trim().toUpperCase();
        if (!normalized) {
            continue;
        }
        if (seen.has(normalized)) {
            duplicates.add(normalized);
            continue;
        }
        seen.add(normalized);
    }

    return Array.from(duplicates).sort();
}

function assertNoDuplicateSecretKeys(rawKeys: unknown[], context: string): void {
    const duplicates = findDuplicateKeys(rawKeys);
    if (duplicates.length > 0) {
        throw {
            status: 400,
            message: `${context} contains duplicate required secret keys: ${duplicates.join(", ")}`
        };
    }
}

export function extractReferencedWorkflowSecrets(runPyContent: string): string[] {
    const found = new Set<string>();
    for (const pattern of PYTHON_SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(runPyContent)) !== null) {
            found.add(match[1]!.trim().toUpperCase());
        }
    }
    return Array.from(found).sort();
}

export function extractReferencedSkillSecrets(skillMarkdownContent: string): string[] {
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    SKILL_SECRET_PLACEHOLDER_PATTERN.lastIndex = 0;
    while ((match = SKILL_SECRET_PLACEHOLDER_PATTERN.exec(skillMarkdownContent)) !== null) {
        found.add(match[1]!);
    }
    return Array.from(found).sort();
}

export function parseWorkflowRequiredSecrets(workflowJsonContent: string): string[] {
    let parsed: { required_secrets?: unknown } | null = null;
    try {
        parsed = JSON.parse(workflowJsonContent) as { required_secrets?: unknown };
    } catch {
        throw {
            status: 400,
            message: "workflow.json must contain valid JSON"
        };
    }

    const rawKeys = Array.isArray(parsed?.required_secrets) ? parsed.required_secrets : [];
    assertNoDuplicateSecretKeys(rawKeys, "workflow.json required_secrets");
    return uniqueNormalizedKeys(rawKeys.filter((item): item is string => typeof item === "string"));
}

function extractSkillFrontmatterBlock(skillMarkdownContent: string): string {
    const frontmatterMatch = skillMarkdownContent.match(/^---\s*\n([\s\S]*?)\n---\s*/);
    return frontmatterMatch?.[1] ?? "";
}

function extractFrontmatterRequiredSecrets(frontmatter: string): { raw: string[]; normalized: string[] } {
    const lines = frontmatter.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const match = line.match(/^required_secrets\s*:\s*(.*)$/);
        if (!match) {
            continue;
        }

        const rawValue = match[1]?.trim() ?? "";
        if (rawValue.startsWith("[")) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(rawValue.replace(/'/g, "\""));
            } catch {
                throw {
                    status: 400,
                    message: "SKILL.md frontmatter required_secrets must be a valid string array"
                };
            }
            if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
                throw {
                    status: 400,
                    message: "SKILL.md frontmatter required_secrets must contain only strings"
                };
            }
            assertNoDuplicateSecretKeys(parsed, "SKILL.md required_secrets");
            return {
                raw: parsed,
                normalized: uniqueNormalizedKeys(parsed),
            };
        }

        if (rawValue.length > 0) {
            assertNoDuplicateSecretKeys([rawValue], "SKILL.md required_secrets");
            return {
                raw: [rawValue],
                normalized: uniqueNormalizedKeys([rawValue]),
            };
        }

        const items: string[] = [];
        for (let itemIndex = index + 1; itemIndex < lines.length; itemIndex += 1) {
            const itemLine = lines[itemIndex] ?? "";
            if (itemLine.trim().length === 0) {
                continue;
            }
            const itemMatch = itemLine.match(/^\s*-\s*(.+)\s*$/);
            if (!itemMatch) {
                break;
            }
            items.push(itemMatch[1]!.replace(/^["']|["']$/g, "").trim());
        }
        assertNoDuplicateSecretKeys(items, "SKILL.md required_secrets");
        return {
            raw: items,
            normalized: uniqueNormalizedKeys(items),
        };
    }

    return {
        raw: [],
        normalized: [],
    };
}

export function parseSkillRequiredSecrets(skillMarkdownContent: string): string[] {
    const { normalized } = extractFrontmatterRequiredSecrets(extractSkillFrontmatterBlock(skillMarkdownContent));
    return normalized;
}

export function validateWorkflowSecretContract(contents: {
    workflowJsonContent: string;
    runPyContent: string;
}): void {
    const declared = new Set(parseWorkflowRequiredSecrets(contents.workflowJsonContent));
    const referenced = extractReferencedWorkflowSecrets(contents.runPyContent);
    const missing = referenced.filter((key) => !declared.has(key));

    if (missing.length > 0) {
        throw {
            status: 400,
            message: `run.py references secret keys not declared in workflow.json required_secrets: ${missing.join(", ")}`
        };
    }
}

export function validateSkillSecretContract(skillMarkdownContent: string): void {
    const declared = new Set(parseSkillRequiredSecrets(skillMarkdownContent));
    const referenced = extractReferencedSkillSecrets(skillMarkdownContent);
    const missing = referenced.filter((key) => !declared.has(key));

    if (missing.length > 0) {
        throw {
            status: 400,
            message: `SKILL.md uses secret placeholders not declared in required_secrets: ${missing.join(", ")}`
        };
    }
}

export function validateWorkflowFilesAtPath(workflowPath: string): void {
    const workflowJsonPath = path.join(workflowPath, "workflow.json");
    const runPyPath = path.join(workflowPath, "run.py");
    validateWorkflowSecretContract({
        workflowJsonContent: fs.readFileSync(workflowJsonPath, "utf-8"),
        runPyContent: fs.readFileSync(runPyPath, "utf-8"),
    });
}
