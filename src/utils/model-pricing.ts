type ModelPricing = {
    inputPerMillionUsd: number;
    cachedInputPerMillionUsd: number;
    outputPerMillionUsd: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
    "gpt-5.3-codex": {
        inputPerMillionUsd: 1.75,
        cachedInputPerMillionUsd: 0.175,
        outputPerMillionUsd: 14,
    },
};

export function getModelPricing(modelId: string): ModelPricing | null {
    return MODEL_PRICING[modelId] ?? null;
}

export function calculateEstimatedCostUsd(args: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
}): number {
    const pricing = getModelPricing(args.modelId);
    if (!pricing) {
        return 0;
    }

    return (
        (args.inputTokens * pricing.inputPerMillionUsd) / 1_000_000
        + (args.cachedTokens * pricing.cachedInputPerMillionUsd) / 1_000_000
        + (args.outputTokens * pricing.outputPerMillionUsd) / 1_000_000
    );
}
