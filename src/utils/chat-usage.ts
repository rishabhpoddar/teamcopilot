import prisma from "../prisma/client";
import { assertCondition } from "./assert";
import { getOpencodeClient } from "./opencode-client";
import { calculateEstimatedCostUsd, getModelPricing } from "./model-pricing";

type OpencodeTokenCache = {
    write: number;
    read: number;
};

type OpencodeAssistantTokens = {
    input: number;
    output: number;
    reasoning: number;
    cache: OpencodeTokenCache;
};

type OpencodeUserMessageInfo = {
    role: "user";
    id: string;
    time: {
        created: number;
    };
};

type OpencodeAssistantMessageInfo = {
    role: "assistant";
    id: string;
    time: {
        created: number;
        completed?: number;
    };
    modelID: string;
    providerID: string;
    tokens: OpencodeAssistantTokens;
};

type OpencodeSessionMessage = {
    info: OpencodeUserMessageInfo | OpencodeAssistantMessageInfo;
};

function assertNonNegativeNumber(value: unknown, label: string): asserts value is number {
    assertCondition(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be a non-negative number`);
}

function assertSessionMessages(value: unknown): asserts value is OpencodeSessionMessage[] {
    assertCondition(Array.isArray(value), "Session messages response is not an array");

    for (const [index, message] of value.entries()) {
        assertCondition(message !== null && typeof message === "object", `Session message at index ${index} must be an object`);
        const messageRecord = message as Record<string, unknown>;
        assertCondition(messageRecord.info !== null && typeof messageRecord.info === "object", `Session message at index ${index} is missing info`);

        const info = messageRecord.info as Record<string, unknown>;
        assertCondition(info.role === "user" || info.role === "assistant", `Session message at index ${index} has invalid role`);
        assertCondition(info.time !== null && typeof info.time === "object", `Session message at index ${index} is missing time`);

        const time = info.time as Record<string, unknown>;
        assertNonNegativeNumber(time.created, `Session message at index ${index} time.created`);
        assertCondition(typeof info.id === "string" && info.id.length > 0, `Session message at index ${index} is missing id`);

        if (info.role === "assistant") {
            assertCondition(typeof info.modelID === "string" && info.modelID.length > 0, `Assistant message at index ${index} is missing modelID`);
            assertCondition(typeof info.providerID === "string" && info.providerID.length > 0, `Assistant message at index ${index} is missing providerID`);
            assertCondition(info.tokens !== null && typeof info.tokens === "object", `Assistant message at index ${index} is missing tokens`);

            const tokens = info.tokens as Record<string, unknown>;
            assertNonNegativeNumber(tokens.input, `Assistant message at index ${index} tokens.input`);
            assertNonNegativeNumber(tokens.output, `Assistant message at index ${index} tokens.output`);
            assertNonNegativeNumber(tokens.reasoning, `Assistant message at index ${index} tokens.reasoning`);
            assertCondition(tokens.cache !== null && typeof tokens.cache === "object", `Assistant message at index ${index} tokens.cache is missing`);

            const cache = tokens.cache as Record<string, unknown>;
            assertNonNegativeNumber(cache.read, `Assistant message at index ${index} tokens.cache.read`);
            assertNonNegativeNumber(cache.write, `Assistant message at index ${index} tokens.cache.write`);

            if (time.completed !== undefined) {
                assertNonNegativeNumber(time.completed, `Assistant message at index ${index} time.completed`);
            }
        }
    }
}

export async function syncChatSessionUsage(chatSessionId: string, opencodeSessionId: string): Promise<void> {
    const client = await getOpencodeClient();
    const result = await client.session.messages({
        path: { id: opencodeSessionId }
    });

    if (result.error) {
        throw new Error("Failed to load session messages for usage sync");
    }

    assertSessionMessages(result.data);
    const messages = result.data;
    const existingUsage = await prisma.chat_session_usage.findUnique({
        where: {
            chat_session_id: chatSessionId,
        }
    });

    let startIndex = 0;
    if (existingUsage) {
        const lastSyncedIndex = messages.findIndex((message) => (
            message.info.role === "assistant"
            && message.info.id === existingUsage.last_synced_message_id
        ));
        if (lastSyncedIndex === -1) {
            return;
        }
        startIndex = lastSyncedIndex + 1;
    }

    let deltaInputTokens = 0;
    let deltaOutputTokens = 0;
    let deltaCachedTokens = 0;
    let latestProcessedAssistantMessageId: string | null = null;
    let latestProcessedProviderId: string | null = null;
    let latestProcessedModelId: string | null = null;

    for (const message of messages.slice(startIndex)) {
        const info = message.info;
        if (info.role !== "assistant") {
            continue;
        }

        deltaInputTokens += info.tokens.input;
        deltaOutputTokens += info.tokens.output;
        deltaCachedTokens += info.tokens.cache.read;
        latestProcessedAssistantMessageId = info.id;
        latestProcessedProviderId = info.providerID;
        latestProcessedModelId = info.modelID;
    }

    if (
        latestProcessedAssistantMessageId === null
        || latestProcessedProviderId === null
        || latestProcessedModelId === null
    ) {
        return;
    }

    const deltaCostUsd = calculateEstimatedCostUsd({
        providerId: latestProcessedProviderId,
        modelId: latestProcessedModelId,
        inputTokens: deltaInputTokens,
        outputTokens: deltaOutputTokens,
        cachedTokens: deltaCachedTokens,
    });

    const nextInputTokens = (existingUsage?.input_tokens ?? 0) + deltaInputTokens;
    const nextOutputTokens = (existingUsage?.output_tokens ?? 0) + deltaOutputTokens;
    const nextCachedTokens = (existingUsage?.cached_tokens ?? 0) + deltaCachedTokens;
    const nextCostUsd = (existingUsage?.cost_usd ?? 0) + deltaCostUsd;

    await prisma.chat_session_usage.upsert({
        where: {
            chat_session_id: chatSessionId,
        },
        create: {
            chat_session_id: chatSessionId,
            last_synced_message_id: latestProcessedAssistantMessageId,
            provider_id: latestProcessedProviderId,
            input_tokens: nextInputTokens,
            output_tokens: nextOutputTokens,
            cached_tokens: nextCachedTokens,
            cost_usd: nextCostUsd,
            model_id: latestProcessedModelId,
            updated_at: BigInt(Date.now()),
        },
        update: {
            last_synced_message_id: latestProcessedAssistantMessageId,
            provider_id: latestProcessedProviderId,
            input_tokens: nextInputTokens,
            output_tokens: nextOutputTokens,
            cached_tokens: nextCachedTokens,
            cost_usd: nextCostUsd,
            model_id: latestProcessedModelId,
            updated_at: BigInt(Date.now()),
        }
    });
}

type UsageRange = "24h" | "7d" | "30d" | "90d";

type UsageBucket = {
    bucket_start: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    cost_usd: number;
    session_count: number;
};

function getRangeConfig(range: UsageRange): { bucketMs: number; windowMs: number } {
    switch (range) {
        case "24h":
            return { bucketMs: 60 * 60 * 1000, windowMs: 24 * 60 * 60 * 1000 };
        case "7d":
            return { bucketMs: 24 * 60 * 60 * 1000, windowMs: 7 * 24 * 60 * 60 * 1000 };
        case "30d":
            return { bucketMs: 24 * 60 * 60 * 1000, windowMs: 30 * 24 * 60 * 60 * 1000 };
        case "90d":
            return { bucketMs: 24 * 60 * 60 * 1000, windowMs: 90 * 24 * 60 * 60 * 1000 };
    }
}

function normalizeUsageRange(value: unknown): UsageRange {
    if (value === "24h" || value === "7d" || value === "30d" || value === "90d") {
        return value;
    }
    return "7d";
}

function getBucketStart(timestamp: number, bucketMs: number): number {
    return Math.floor(timestamp / bucketMs) * bucketMs;
}

export async function buildUsageOverview(rawRange: unknown) {
    const range = normalizeUsageRange(rawRange);
    const { bucketMs, windowMs } = getRangeConfig(range);
    const now = Date.now();
    const rangeStart = now - windowMs;

    const usageRows = await prisma.chat_session_usage.findMany({
        where: {
            session: {
                updated_at: {
                    gte: BigInt(rangeStart),
                    lte: BigInt(now),
                }
            }
        },
        include: {
            session: {
                select: {
                    updated_at: true,
                }
            }
        }
    });

    const bucketMap = new Map<number, UsageBucket>();
    const modelMap = new Map<string, {
        provider_id: string;
        model_id: string;
        input_tokens: number;
        output_tokens: number;
        cached_tokens: number;
        cost_usd: number;
        session_count: number;
        pricing_available: boolean;
    }>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalCostUsd = 0;

    for (const row of usageRows) {
        const sessionUpdatedAt = Number(row.session.updated_at);
        const bucketStart = getBucketStart(sessionUpdatedAt, bucketMs);
        const bucket = bucketMap.get(bucketStart) ?? {
            bucket_start: bucketStart,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            cost_usd: 0,
            session_count: 0,
        };

        bucket.input_tokens += row.input_tokens;
        bucket.output_tokens += row.output_tokens;
        bucket.cached_tokens += row.cached_tokens;
        bucket.cost_usd += row.cost_usd;
        bucket.session_count += 1;
        bucketMap.set(bucketStart, bucket);

        const modelKey = `${row.provider_id}:${row.model_id}`;
        const model = modelMap.get(modelKey) ?? {
            provider_id: row.provider_id,
            model_id: row.model_id,
            input_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            cost_usd: 0,
            session_count: 0,
            pricing_available: getModelPricing(row.provider_id, row.model_id) !== null,
        };
        model.input_tokens += row.input_tokens;
        model.output_tokens += row.output_tokens;
        model.cached_tokens += row.cached_tokens;
        model.cost_usd += row.cost_usd;
        model.session_count += 1;
        modelMap.set(modelKey, model);

        totalInputTokens += row.input_tokens;
        totalOutputTokens += row.output_tokens;
        totalCachedTokens += row.cached_tokens;
        totalCostUsd += row.cost_usd;
    }

    const bucketStarts: number[] = [];
    for (let time = getBucketStart(rangeStart, bucketMs); time <= getBucketStart(now, bucketMs); time += bucketMs) {
        bucketStarts.push(time);
    }

    const timeseries = bucketStarts.map((bucketStart) => bucketMap.get(bucketStart) ?? {
        bucket_start: bucketStart,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cost_usd: 0,
        session_count: 0,
    });

    const models = Array.from(modelMap.values()).sort((a, b) => b.cost_usd - a.cost_usd);
    const pricing: Record<string, {
        provider_id: string;
        input_per_million_usd: number;
        cached_input_per_million_usd: number;
        output_per_million_usd: number;
    }> = {};
    for (const model of models) {
        const modelPricing = getModelPricing(model.provider_id, model.model_id);
        if (!modelPricing) {
            continue;
        }
        pricing[`${model.provider_id}:${model.model_id}`] = {
            provider_id: model.provider_id,
            input_per_million_usd: modelPricing.inputPerMillionUsd,
            cached_input_per_million_usd: modelPricing.cachedInputPerMillionUsd,
            output_per_million_usd: modelPricing.outputPerMillionUsd,
        };
    }

    return {
        range,
        estimated: true,
        summary: {
            total_input_tokens: totalInputTokens,
            total_output_tokens: totalOutputTokens,
            total_cached_tokens: totalCachedTokens,
            total_cost_usd: totalCostUsd,
            session_count: usageRows.length,
        },
        timeseries,
        models,
        pricing,
    };
}
