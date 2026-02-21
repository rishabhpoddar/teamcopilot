export function assertCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

export function assertEnv(name: string): string {
    const value = process.env[name];
    assertCondition(typeof value === "string" && value.length > 0, `${name} is not set`);
    return value;
}

export function parseIntStrict(raw: string, label: string): number {
    const parsed = Number.parseInt(raw, 10);
    assertCondition(Number.isFinite(parsed), `${label} must be a valid integer`);
    return parsed;
}
