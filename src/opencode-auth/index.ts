import express from "express";
import { apiHandler } from "../utils/index";
import {
    getConfiguredModelProviderId,
    getRuntimeProviderAuth,
    hasRuntimeProviderAuth,
    setRuntimeProviderAuth,
} from "../utils/opencode-auth";
import { getOpencodePort, getWorkspaceDir } from "../utils/opencode-client";

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

async function fetchProviderAuthMethods(providerId: string): Promise<ProviderAuthMethod[]> {
    const directory = encodeURIComponent(getWorkspaceDir());
    const response = await fetch(`${getOpencodeBaseUrl()}/provider/auth?directory=${directory}`);

    if (!response.ok) {
        const errorMessage = await response.text();
        throw {
            status: 500,
            message: `Failed to fetch provider auth methods from opencode: ${errorMessage}`,
        };
    }

    const data = await response.json() as Record<string, Array<{ type: "api" | "oauth"; label: string }>>;
    const methods = data[providerId] || [];
    return methods.map((method, index) => ({
        index,
        type: method.type,
        label: method.label,
    }));
}

router.get("/status", apiHandler(async (_req, res) => {
    const providerId = getConfiguredModelProviderId();
    const model = process.env.OPENCODE_MODEL!;
    const methods = await fetchProviderAuthMethods(providerId);
    const auth = await getRuntimeProviderAuth(providerId);

    res.json({
        provider_id: providerId,
        model,
        has_credentials: await hasRuntimeProviderAuth(providerId),
        configured_auth_type: auth?.type,
        methods,
    });
}, true));

router.post("/api", apiHandler(async (req, res) => {
    const providerId = getConfiguredModelProviderId();
    const key = req.body?.key;

    if (typeof key !== "string" || key.length === 0) {
        throw {
            status: 400,
            message: "key is required",
        };
    }

    await setRuntimeProviderAuth(providerId, {
        type: "api",
        key,
    });

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
    const response = await fetch(
        `${getOpencodeBaseUrl()}/provider/${encodeURIComponent(providerId)}/oauth/authorize?directory=${directory}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ method }),
        },
    );

    if (!response.ok) {
        const errorMessage = await response.text();
        throw {
            status: 400,
            message: `Failed to initiate OAuth flow: ${errorMessage}`,
        };
    }

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
    const response = await fetch(
        `${getOpencodeBaseUrl()}/provider/${encodeURIComponent(providerId)}/oauth/callback?directory=${directory}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ method, code }),
        },
    );

    if (!response.ok) {
        const errorMessage = await response.text();
        throw {
            status: 400,
            message: `Failed to complete OAuth callback: ${errorMessage}`,
        };
    }

    if (!(await hasRuntimeProviderAuth(providerId))) {
        throw {
            status: 400,
            message: `OAuth callback completed but no credentials were stored for provider ${providerId}`,
        };
    }

    res.json({ success: true });
}, true));

export default router;
