import express from "express";
import { apiHandler } from "../utils/index";
import {
    getConfiguredModelProviderId,
    getProviderApiKeyEnvKey,
    getProviderSetupDefinition,
    hasRuntimeProviderCredentials,
    getRuntimeProviderConfigValues,
    getRuntimeProviderAuth,
    setRuntimeProviderConfigValues,
    setRuntimeProviderAuth,
} from "../utils/opencode-auth";
import { getOpencodePort, getWorkspaceDir } from "../utils/opencode-client";
import { restartOpencodeServer } from "../opencode-server";

const router = express.Router({ mergeParams: true });

type ProviderAuthMethod = {
    index: number;
    type: "api" | "oauth";
    label: string;
};

type AuthorizeResponse = {
    url: string;
    method: "auto" | "code";
    instructions: string;
};

function getOpencodeBaseUrl(): string {
    return `http://localhost:${getOpencodePort()}`;
}

async function opencodeRequest(
    input: string,
    init: RequestInit | undefined,
    errorMessagePrefix: string,
    status: number,
): Promise<Response> {
    const response = await fetch(input, init);
    if (!response.ok) {
        const errorMessage = await response.text();
        throw {
            status,
            message: `${errorMessagePrefix}: ${errorMessage}`,
        };
    }
    return response;
}

async function fetchProviderAuthMethods(providerId: string): Promise<ProviderAuthMethod[]> {
    const directory = encodeURIComponent(getWorkspaceDir());
    const response = await opencodeRequest(
        `${getOpencodeBaseUrl()}/provider/auth?directory=${directory}`,
        undefined,
        "Failed to fetch provider auth methods from opencode",
        500,
    );

    const data = await response.json() as Record<string, Array<{ type: "api" | "oauth"; label: string }>>;
    const methods = data[providerId] || [];
    return methods.map((method, index) => ({
        index,
        type: method.type,
        label: method.label,
    }));
}

function withProviderSpecificFallbackMethods(
    providerId: string,
    methods: ProviderAuthMethod[],
): ProviderAuthMethod[] {
    if (methods.length > 0) {
        return methods;
    }

    const definition = getProviderSetupDefinition(providerId);
    if (definition.configFields.length === 0) {
        return methods;
    }

    return [{
        index: 0,
        type: "api",
        label: "Manually enter API Key",
    }];
}

router.get("/status", apiHandler(async (_req, res) => {
    const providerId = getConfiguredModelProviderId();
    const model = process.env.OPENCODE_MODEL!;
    const methods = withProviderSpecificFallbackMethods(
        providerId,
        await fetchProviderAuthMethods(providerId),
    );
    const auth = await getRuntimeProviderAuth(providerId);
    const hasCredentials = await hasRuntimeProviderCredentials(providerId);
    const definition = getProviderSetupDefinition(providerId);
    const configValues = await getRuntimeProviderConfigValues(providerId);

    res.json({
        provider_id: providerId,
        model,
        has_credentials: hasCredentials,
        configured_auth_type: auth?.type,
        methods,
        config_fields: definition.configFields.map((field) => ({
            key: field.key,
            label: field.label,
            placeholder: field.placeholder,
            help: field.help,
            required: field.required,
            input: field.input,
        })).concat(definition.optionFields.map((field) => ({
            key: field.key,
            label: field.label,
            placeholder: field.placeholder,
            help: field.help,
            required: field.required,
            input: field.input,
        }))),
        config_values: configValues,
        setup_notes: definition.notes,
    });
}, true));

router.post("/api", apiHandler(async (req, res) => {
    const providerId = getConfiguredModelProviderId();
    const key = req.body?.key;
    const configValues = req.body?.config_values;
    const definition = getProviderSetupDefinition(providerId);
    const apiKeyEnvKey = getProviderApiKeyEnvKey(providerId);

    if (typeof key !== "string" || key.length === 0) {
        throw {
            status: 400,
            message: "key is required",
        };
    }

    if (configValues !== undefined && (typeof configValues !== "object" || configValues === null || Array.isArray(configValues))) {
        throw {
            status: 400,
            message: "config_values must be an object",
        };
    }

    if (definition.configFields.length > 0) {
        try {
            const nextConfigValues = {
                ...((configValues ?? {}) as Record<string, string>),
                ...(apiKeyEnvKey ? { apiKey: key } : {}),
            };
            await setRuntimeProviderConfigValues(providerId, nextConfigValues);
        } catch (err) {
            throw {
                status: 400,
                message: err instanceof Error ? err.message : "Invalid provider configuration",
            };
        }
    }

    await setRuntimeProviderAuth(providerId, {
        type: "api",
        key,
    });
    await restartOpencodeServer();

    res.json({ success: true });
}, true));

router.post("/oauth/authorize", apiHandler(async (req, res) => {
    const providerId = getConfiguredModelProviderId();
    const method = req.body?.method;

    if (typeof method !== "number") {
        throw {
            status: 400,
            message: "method is required",
        };
    }

    const directory = encodeURIComponent(getWorkspaceDir());
    const response = await opencodeRequest(
        `${getOpencodeBaseUrl()}/provider/${encodeURIComponent(providerId)}/oauth/authorize?directory=${directory}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ method }),
        },
        "Failed to initiate OAuth flow",
        400,
    );

    const data = await response.json() as AuthorizeResponse | null;
    if (!data) {
        throw {
            status: 400,
            message: "Selected auth method is not OAuth",
        };
    }

    res.json(data);
}, true));

router.post("/oauth/callback", apiHandler(async (req, res) => {
    const providerId = getConfiguredModelProviderId();
    const method = req.body?.method;
    const code = req.body?.code;

    if (typeof method !== "number") {
        throw {
            status: 400,
            message: "method is required",
        };
    }

    if (code !== undefined && typeof code !== "string") {
        throw {
            status: 400,
            message: "code must be a string",
        };
    }

    const directory = encodeURIComponent(getWorkspaceDir());
    await opencodeRequest(
        `${getOpencodeBaseUrl()}/provider/${encodeURIComponent(providerId)}/oauth/callback?directory=${directory}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ method, code }),
        },
        "Failed to complete OAuth callback",
        400,
    );

    if (!await getRuntimeProviderAuth(providerId)) {
        throw {
            status: 400,
            message: `OAuth callback completed but no credentials were stored for provider ${providerId}`,
        };
    }

    await restartOpencodeServer();

    res.json({ success: true });
}, true));

export default router;
