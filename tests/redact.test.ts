import assert from "node:assert/strict";
import { sanitizeForClient, sanitizeStringContent } from "../src/utils/redact";

type StringCase = {
    name: string;
    input: string;
    expected: string;
};

type ObjectCase = {
    name: string;
    input: unknown;
    expected: unknown;
};

const stringCases: StringCase[] = [
    {
        name: "diff line token redaction (+/-) and heading unchanged",
        input: "## Auth token\n-Token: glpat-EHzjVDNhKux-NC1cA7jx\n+Token: glpat-foobarblaha\n",
        expected: "## Auth token\n-Token: ***7jx\n+Token: ***aha\n",
    },
    {
        name: "dotenv assignment redaction",
        input: "API_KEY=abcdef123456\nNORMAL=value\n",
        expected: "API_KEY=***456\nNORMAL=value\n",
    },
    {
        name: "quoted assignment redaction",
        input: "password=\"super-secret-pass\"\nTOKEN='hello-world-12345'\n",
        expected: "password=\"***ass\"\nTOKEN='***345'\n",
    },
    {
        name: "markdown key value redaction",
        input: "- **password**: hunter2\n> __token__ = \"abcdef\"\n",
        expected: "- **password**: ***er2\n> __token__ = \"***def\"\n",
    },
    {
        name: "curl header bearer token redaction",
        input: "curl -H \"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def\" https://example.com",
        expected: "curl -H \"Authorization: Bearer ***def\" https://example.com",
    },
    {
        name: "curl lowercase bearer token redaction",
        input: "curl -H 'authorization: bearer myverylongtokensecretvalue' http://localhost:5124",
        expected: "curl -H 'authorization: bearer ***lue' http://localhost:5124",
    },
    {
        name: "curl api key header redaction",
        input: "curl -H \"X-API-Key: abcdefghijklmnop\" https://api.test.dev",
        expected: "curl -H \"X-API-Key: ***nop\" https://api.test.dev",
    },
    {
        name: "openai style key redaction",
        input: "Authorization: sk-1234567890abcdef",
        expected: "Authorization: ***def",
    },
    {
        name: "github style token redaction",
        input: "token=ghp_1234567890ABCDEF",
        expected: "token=***DEF",
    },
    {
        name: "non-sensitive heading should not redact",
        input: "## Auth token\nThis section describes authentication basics.\n",
        expected: "## Auth token\nThis section describes authentication basics.\n",
    },
    {
        name: "multiple assignments per line",
        input: "token=abc123 password=def456 project=localtool",
        expected: "token=***123 password=***456 project=localtool",
    },
];

const objectCases: ObjectCase[] = [
    {
        name: "sanitizeForClient masks sensitive object keys recursively",
        input: {
            token: "1234567890",
            auth: {
                password: "topsecret",
                nested: [{ apiKey: "abcdefg" }, { value: "ok" }],
            },
            label: "safe",
        },
        expected: {
            token: "***890",
            auth: {
                password: "***ret",
                nested: [{ apiKey: "***efg" }, { value: "ok" }],
            },
            label: "safe",
        },
    },
    {
        name: "sanitizeForClient masks sensitive keys in nested JSON arrays",
        input: {
            events: [
                {
                    type: "auth",
                    metadata: {
                        token: "tok_abcdefghijklmnop",
                        secret_value: "hidden-secret",
                    },
                },
                {
                    type: "api",
                    metadata: {
                        api_key: "api-key-xyz-123",
                        notes: "keep-this",
                    },
                },
            ],
        },
        expected: {
            events: [
                {
                    type: "auth",
                    metadata: {
                        token: "***nop",
                        secret_value: "***ret",
                    },
                },
                {
                    type: "api",
                    metadata: {
                        api_key: "***123",
                        notes: "keep-this",
                    },
                },
            ],
        },
    },
    {
        name: "sanitizeForClient masks JSON payload fields but preserves non-sensitive keys",
        input: {
            payload: {
                user: "alice",
                password: "Password123!",
                config: {
                    credential: "cred-value-001",
                    region: "us-east-1",
                },
                tags: ["one", "two"],
            },
        },
        expected: {
            payload: {
                user: "alice",
                password: "***23!",
                config: {
                    credential: "***001",
                    region: "us-east-1",
                },
                tags: ["one", "two"],
            },
        },
    },
];

function runStringCases(): void {
    for (const testCase of stringCases) {
        const actual = sanitizeStringContent(testCase.input);
        assert.equal(
            actual,
            testCase.expected,
            `Failed case: ${testCase.name}\nInput:\n${testCase.input}\nActual:\n${actual}\nExpected:\n${testCase.expected}`
        );
    }
}

function runObjectCases(): void {
    for (const testCase of objectCases) {
        const actual = sanitizeForClient(testCase.input);
        assert.deepEqual(
            actual,
            testCase.expected,
            `Failed case: ${testCase.name}\nActual:\n${JSON.stringify(actual, null, 2)}\nExpected:\n${JSON.stringify(testCase.expected, null, 2)}`
        );
    }
}

function main(): void {
    runStringCases();
    runObjectCases();
    console.log(`Redaction tests passed: ${stringCases.length + objectCases.length}`);
}

main();
