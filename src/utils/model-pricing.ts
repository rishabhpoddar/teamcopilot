type ModelPricing = {
    inputPerMillionUsd: number;
    cachedInputPerMillionUsd: number;
    outputPerMillionUsd: number;
};

const MODEL_PRICING: Record<string, Record<string, ModelPricing>> = {
    openai: {
        "gpt-5.4": {
            inputPerMillionUsd: 2.5,
            cachedInputPerMillionUsd: 0.25,
            outputPerMillionUsd: 15,
        },
        "gpt-5.4-mini": {
            inputPerMillionUsd: 0.75,
            cachedInputPerMillionUsd: 0.075,
            outputPerMillionUsd: 4.5,
        },
        "gpt-5.4-nano": {
            inputPerMillionUsd: 0.2,
            cachedInputPerMillionUsd: 0.02,
            outputPerMillionUsd: 1.25,
        },
        "gpt-5.3-chat-latest": {
            inputPerMillionUsd: 1.75,
            cachedInputPerMillionUsd: 0.175,
            outputPerMillionUsd: 14,
        },
        "gpt-5.3-codex": {
            inputPerMillionUsd: 1.75,
            cachedInputPerMillionUsd: 0.175,
            outputPerMillionUsd: 14,
        },
        "gpt-5.1": {
            inputPerMillionUsd: 1.25,
            cachedInputPerMillionUsd: 0.125,
            outputPerMillionUsd: 10,
        },
        "gpt-5": {
            inputPerMillionUsd: 1.25,
            cachedInputPerMillionUsd: 0.125,
            outputPerMillionUsd: 10,
        },
        "gpt-5-mini": {
            inputPerMillionUsd: 0.25,
            cachedInputPerMillionUsd: 0.025,
            outputPerMillionUsd: 2,
        },
        "gpt-5-nano": {
            inputPerMillionUsd: 0.05,
            cachedInputPerMillionUsd: 0.005,
            outputPerMillionUsd: 0.4,
        }
    },
};

function assertNonNegativeNumber(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative number`);
    }
}

function parseOptionalNonNegativeNumber(raw: string | undefined, label: string): number | null {
    if (raw === undefined || raw.length === 0) {
        return null;
    }

    const parsed = Number(raw);
    assertNonNegativeNumber(parsed, label);
    return parsed;
}

function getPricingOverrideForConfiguredModel(providerId: string, modelId: string): ModelPricing | null {
    const configuredModel = process.env.OPENCODE_MODEL;
    if (!configuredModel) {
        return null;
    }

    const [configuredProviderId, ...configuredModelParts] = configuredModel.split("/");
    const configuredModelId = configuredModelParts.join("/");
    if (!configuredProviderId || !configuredModelId) {
        throw new Error("OPENCODE_MODEL must be in the format <provider>/<model>");
    }

    if (providerId !== configuredProviderId || modelId !== configuredModelId) {
        return null;
    }

    const inputPerMillionUsd = parseOptionalNonNegativeNumber(
        process.env.TEAMCOPILOT_MODEL_INPUT_PER_MILLION_USD,
        "TEAMCOPILOT_MODEL_INPUT_PER_MILLION_USD"
    );
    const cachedInputPerMillionUsd = parseOptionalNonNegativeNumber(
        process.env.TEAMCOPILOT_MODEL_CACHED_INPUT_PER_MILLION_USD,
        "TEAMCOPILOT_MODEL_CACHED_INPUT_PER_MILLION_USD"
    );
    const outputPerMillionUsd = parseOptionalNonNegativeNumber(
        process.env.TEAMCOPILOT_MODEL_OUTPUT_PER_MILLION_USD,
        "TEAMCOPILOT_MODEL_OUTPUT_PER_MILLION_USD"
    );

    if (inputPerMillionUsd === null && cachedInputPerMillionUsd === null && outputPerMillionUsd === null) {
        return null;
    }

    if (inputPerMillionUsd === null || cachedInputPerMillionUsd === null || outputPerMillionUsd === null) {
        throw new Error(
            "TEAMCOPILOT_MODEL_INPUT_PER_MILLION_USD, TEAMCOPILOT_MODEL_CACHED_INPUT_PER_MILLION_USD, and TEAMCOPILOT_MODEL_OUTPUT_PER_MILLION_USD must either all be set or all be unset"
        );
    }

    return {
        inputPerMillionUsd,
        cachedInputPerMillionUsd,
        outputPerMillionUsd,
    };
}

export function getModelPricing(providerId: string, modelId: string): ModelPricing | null {
    const override = getPricingOverrideForConfiguredModel(providerId, modelId);
    if (override) {
        return override;
    }
    return MODEL_PRICING[providerId]?.[modelId] ?? null;
}

export function calculateEstimatedCostUsd(args: {
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
}): number {
    const pricing = getModelPricing(args.providerId, args.modelId);
    if (!pricing) {
        return 0;
    }

    return (
        (args.inputTokens * pricing.inputPerMillionUsd) / 1_000_000
        + (args.cachedTokens * pricing.cachedInputPerMillionUsd) / 1_000_000
        + (args.outputTokens * pricing.outputPerMillionUsd) / 1_000_000
    );
}
