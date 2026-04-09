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
        },
        "gpt-4.1": {
            inputPerMillionUsd: 2,
            cachedInputPerMillionUsd: 0.5,
            outputPerMillionUsd: 8,
        },
        "gpt-4.1-mini": {
            inputPerMillionUsd: 0.4,
            cachedInputPerMillionUsd: 0.1,
            outputPerMillionUsd: 1.6,
        },
        "gpt-4.1-nano": {
            inputPerMillionUsd: 0.1,
            cachedInputPerMillionUsd: 0.025,
            outputPerMillionUsd: 0.4,
        },
        "gpt-4o": {
            inputPerMillionUsd: 2.5,
            cachedInputPerMillionUsd: 1.25,
            outputPerMillionUsd: 10,
        },
        "gpt-4o-mini": {
            inputPerMillionUsd: 0.15,
            cachedInputPerMillionUsd: 0.075,
            outputPerMillionUsd: 0.6,
        },
        "o4-mini": {
            inputPerMillionUsd: 1.1,
            cachedInputPerMillionUsd: 0.275,
            outputPerMillionUsd: 4.4,
        },
        "o3-mini": {
            inputPerMillionUsd: 1.1,
            cachedInputPerMillionUsd: 0.55,
            outputPerMillionUsd: 4.4,
        },
    },
};

export function getModelPricing(providerId: string, modelId: string): ModelPricing | null {
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
