const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|auth|credential)/i;

export function maskValue(value: string): string {
    if (value.startsWith("***")) {
        return value;
    }
    const suffixLength = value.length <= 3 ? 1 : 3;
    const tail = value.slice(-suffixLength);
    return `***${tail}`;
}

export function isLikelySensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERN.test(key);
}

export function sanitizeStringContent(input: string): string {
    let text = input;

    // Redact Authorization header bearer tokens before generic key/value masking so
    // "Authorization: Bearer <token>" doesn't get partially masked as "***rer".
    text = text.replace(
        /(\bAuthorization\s*[:=]\s*)(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
        (_full: string, prefix: string, bearer: string, token: string) => `${prefix}${bearer}${maskValue(token)}`
    );

    // Redact sensitive markdown list/label items such as:
    // - **password**: value
    // - **password** = value
    // > __token__ : "value"
    text = text.replace(
        /(^|[\r\n])([ \t>]*(?:[-*+][ \t]+)?)(\*\*|__)[ \t]*([A-Za-z_][A-Za-z0-9_-]*)[ \t]*(\3)([ \t]*(?::|=)[ \t]*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'#;,)\]}]+))/gm,
        (
            full: string,
            lineLead: string,
            prefix: string,
            openMarker: string,
            key: string,
            closeMarker: string,
            separator: string,
            doubleQuoted: string | undefined,
            singleQuoted: string | undefined,
            bare: string | undefined
        ) => {
            if (!isLikelySensitiveKey(key)) {
                return full;
            }

            const rawValue = doubleQuoted ?? singleQuoted ?? bare ?? "";
            if (!rawValue) {
                return full;
            }

            const masked = maskValue(rawValue);
            if (doubleQuoted !== undefined) {
                return `${lineLead}${prefix}${openMarker}${key}${closeMarker}${separator}"${masked}"`;
            }
            if (singleQuoted !== undefined) {
                return `${lineLead}${prefix}${openMarker}${key}${closeMarker}${separator}'${masked}'`;
            }
            return `${lineLead}${prefix}${openMarker}${key}${closeMarker}${separator}${masked}`;
        }
    );

    // Redact sensitive env-style assignments anywhere in text, including multiple
    // assignments per line and text prefixes.
    text = text.replace(
        /(^|[^A-Za-z0-9_])((?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_-]*)[ \t]*(?:=|:)[ \t]*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'#;,)\]}]+))/gm,
        (
            full: string,
            lead: string,
            assignmentPrefix: string,
            key: string,
            doubleQuoted: string | undefined,
            singleQuoted: string | undefined,
            bare: string | undefined
        ) => {
            if (!isLikelySensitiveKey(key)) {
                return full;
            }

            const rawValue = doubleQuoted ?? singleQuoted ?? bare ?? "";
            if (!rawValue) {
                return full;
            }

            if (key.toLowerCase() === "authorization" && /^bearer$/i.test(rawValue)) {
                return full;
            }

            const authorizationMatch = rawValue.match(/^([Bb]earer\s+)([^\s"']+)$/);
            if (key.toLowerCase() === "authorization" && authorizationMatch) {
                const bearerPrefix = authorizationMatch[1];
                const bearerToken = authorizationMatch[2];
                const maskedBearer = `${bearerPrefix}${maskValue(bearerToken)}`;
                if (doubleQuoted !== undefined) {
                    return `${lead}${assignmentPrefix}"${maskedBearer}"`;
                }
                if (singleQuoted !== undefined) {
                    return `${lead}${assignmentPrefix}'${maskedBearer}'`;
                }
                return `${lead}${assignmentPrefix}${maskedBearer}`;
            }

            const masked = maskValue(rawValue);
            if (doubleQuoted !== undefined) {
                return `${lead}${assignmentPrefix}"${masked}"`;
            }
            if (singleQuoted !== undefined) {
                return `${lead}${assignmentPrefix}'${masked}'`;
            }
            return `${lead}${assignmentPrefix}${masked}`;
        }
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
