const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|auth|credential)/i;

function maskValue(value: string): string {
    if (value.startsWith("***")) {
        return value;
    }
    const suffixLength = value.length <= 3 ? 1 : 3;
    const tail = value.slice(-suffixLength);
    return `***${tail}`;
}

function isLikelySensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeEnvAssignmentLine(line: string): string {
    const match = line.match(/^(\s*(?:\d+\s*[:|]\s*)?(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/);
    if (!match) {
        return line;
    }

    const prefix = match[1];
    const lineRemainder = (match[2] || "").trim();
    const commentIndex = lineRemainder.indexOf(" #");
    const rawValue = commentIndex >= 0 ? lineRemainder.slice(0, commentIndex).trim() : lineRemainder;
    const trailingComment = commentIndex >= 0 ? lineRemainder.slice(commentIndex) : "";
    if (!rawValue || rawValue.startsWith("#")) {
        return line;
    }

    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
        const quote = rawValue[0];
        const inner = rawValue.slice(1, -1);
        return `${prefix}${quote}${maskValue(inner)}${quote}${trailingComment}`;
    }

    const trailingPunctuationMatch = rawValue.match(/([:;,\])}>]+)$/);
    const trailingPunctuation = trailingPunctuationMatch ? trailingPunctuationMatch[1] : "";
    const coreValue = trailingPunctuation ? rawValue.slice(0, -trailingPunctuation.length) : rawValue;

    return `${prefix}${maskValue(coreValue)}${trailingPunctuation}${trailingComment}`;
}

export function sanitizeStringContent(input: string): string {
    let text = input;

    // Redact dotenv-like assignments (KEY=value).
    text = text
        .split("\n")
        .map(sanitizeEnvAssignmentLine)
        .join("\n");

    // Redact sensitive key-value patterns in plain text and JSON-like text.
    text = text.replace(
        /((?:token|secret|password|passwd|api[_-]?key|authorization|credential)s?\s*[:=]\s*)(["']?)([A-Za-z0-9._~+/=-]+)(\2)/gi,
        (_full, prefix: string, quote: string, value: string) => `${prefix}${quote}${maskValue(value)}${quote}`
    );

    // Redact common bearer and provider token forms.
    text = text.replace(/\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})\b/gi, (_full, prefix: string, token: string) => `${prefix}${maskValue(token)}`);
    text = text.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, (token: string) => maskValue(token));
    text = text.replace(/\b(ghp_[A-Za-z0-9]{8,})\b/g, (token: string) => maskValue(token));

    return text;
}

function sanitizeObjectRecord(input: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string" && isLikelySensitiveKey(key)) {
            output[key] = maskValue(value);
            continue;
        }
        output[key] = sanitizeForClient(value);
    }
    return output;
}

export function sanitizeForClient<T>(input: T): T {
    if (typeof input === "string") {
        return sanitizeStringContent(input) as T;
    }
    if (Array.isArray(input)) {
        return input.map((item) => sanitizeForClient(item)) as T;
    }
    if (input && typeof input === "object") {
        return sanitizeObjectRecord(input as Record<string, unknown>) as T;
    }
    return input;
}
