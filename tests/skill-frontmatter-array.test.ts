import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

function loadFrontmatterHelpers(): {
    extractFrontmatterValue: (frontmatter: string, key: string) => string | null;
    extractFrontmatterStringArray: (frontmatter: string, key: string) => string[];
} {
    const skillUtilsPath = path.join(process.cwd(), "src", "utils", "skill.ts");
    const source = fs.readFileSync(skillUtilsPath, "utf-8");
    const startMarker = "function extractFrontmatterValue";
    const endMarker = "function readSkillManifest";
    const startIndex = source.indexOf(startMarker);
    const endIndex = source.indexOf(endMarker);
    assert.notEqual(startIndex, -1, "Failed to locate extractFrontmatterValue in src/utils/skill.ts");
    assert.notEqual(endIndex, -1, "Failed to locate readSkillManifest in src/utils/skill.ts");

    const snippet = `${source.slice(startIndex, endIndex)}\nmodule.exports = { extractFrontmatterValue, extractFrontmatterStringArray };`;
    const transpiled = ts.transpileModule(snippet, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        }
    }).outputText;

    const sandbox = {
        module: {
            exports: {} as {
                extractFrontmatterValue?: (frontmatter: string, key: string) => string | null;
                extractFrontmatterStringArray?: (frontmatter: string, key: string) => string[];
            }
        },
        exports: {},
    };
    vm.runInNewContext(transpiled, sandbox, { filename: "skill-frontmatter-array-snippet.js" });
    assert.equal(typeof sandbox.module.exports.extractFrontmatterValue, "function", "Failed to load extractFrontmatterValue");
    assert.equal(typeof sandbox.module.exports.extractFrontmatterStringArray, "function", "Failed to load extractFrontmatterStringArray");
    return {
        extractFrontmatterValue: sandbox.module.exports.extractFrontmatterValue!,
        extractFrontmatterStringArray: sandbox.module.exports.extractFrontmatterStringArray!,
    };
}

type ArrayTestCase = {
    name: string;
    frontmatter: string;
    key?: string;
    expected: string[];
};

type ValueTestCase = {
    name: string;
    frontmatter: string;
    key?: string;
    expected: string | null;
};

const { extractFrontmatterValue, extractFrontmatterStringArray } = loadFrontmatterHelpers();

const arrayCases: ArrayTestCase[] = [
    {
        name: "returns empty array when key is missing",
        frontmatter: "name: test-skill\ndescription: demo\n",
        expected: [],
    },
    {
        name: "parses single bare scalar value",
        frontmatter: "required_secrets: OPENAI_API_KEY\n",
        expected: ["OPENAI_API_KEY"],
    },
    {
        name: "parses single quoted scalar value",
        frontmatter: "required_secrets: \"OPENAI_API_KEY\"\n",
        expected: ["OPENAI_API_KEY"],
    },
    {
        name: "parses json style inline array",
        frontmatter: "required_secrets: [\"OPENAI_API_KEY\", \"GITHUB_TOKEN\"]\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "parses single-quoted inline array",
        frontmatter: "required_secrets: ['OPENAI_API_KEY', 'GITHUB_TOKEN']\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "trims values from inline array",
        frontmatter: "required_secrets: [\" OPENAI_API_KEY \", \"GITHUB_TOKEN  \"]\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "drops empty strings from inline array",
        frontmatter: "required_secrets: [\"OPENAI_API_KEY\", \"\", \"   \"]\n",
        expected: ["OPENAI_API_KEY"],
    },
    {
        name: "returns empty array for malformed inline array",
        frontmatter: "required_secrets: [OPENAI_API_KEY, GITHUB_TOKEN]\n",
        expected: [],
    },
    {
        name: "returns empty array for non-string inline members",
        frontmatter: "required_secrets: [\"OPENAI_API_KEY\", 123, true]\n",
        expected: [],
    },
    {
        name: "parses multi-line yaml list",
        frontmatter: "required_secrets:\n  - OPENAI_API_KEY\n  - GITHUB_TOKEN\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "parses multi-line yaml list with quoted values",
        frontmatter: "required_secrets:\n  - \"OPENAI_API_KEY\"\n  - 'GITHUB_TOKEN'\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "skips blank lines inside yaml list",
        frontmatter: "required_secrets:\n\n  - OPENAI_API_KEY\n\n  - GITHUB_TOKEN\n",
        expected: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    },
    {
        name: "stops list parsing at next non-list field",
        frontmatter: "required_secrets:\n  - OPENAI_API_KEY\ndescription: hello\n  - GITHUB_TOKEN\n",
        expected: ["OPENAI_API_KEY"],
    },
    {
        name: "filters empty yaml list items after trimming",
        frontmatter: "required_secrets:\n  - \"\"\n  - OPENAI_API_KEY\n  - '   '\n",
        expected: ["OPENAI_API_KEY"],
    },
    {
        name: "supports alternate key names",
        key: "tags",
        frontmatter: "required_secrets: [\"OPENAI_API_KEY\"]\ntags:\n  - internal\n  - ai\n",
        expected: ["internal", "ai"],
    },
    {
        name: "ignores keys with similar prefixes",
        frontmatter: "required_secrets_extra: [\"NOPE\"]\nrequired_secrets: [\"OPENAI_API_KEY\"]\n",
        expected: ["OPENAI_API_KEY"],
    },
];

const valueCases: ValueTestCase[] = [
    {
        name: "returns null when key is missing",
        frontmatter: "name: test-skill\ndescription: demo\n",
        key: "intent_summary",
        expected: null,
    },
    {
        name: "parses bare scalar value",
        frontmatter: "name: demo-skill\n",
        key: "name",
        expected: "demo-skill",
    },
    {
        name: "parses double quoted scalar value",
        frontmatter: "description: \"Skill description\"\n",
        key: "description",
        expected: "Skill description",
    },
    {
        name: "parses single quoted scalar value",
        frontmatter: "description: 'Skill description'\n",
        key: "description",
        expected: "Skill description",
    },
    {
        name: "returns empty string for explicitly empty scalar",
        frontmatter: "description:\n",
        key: "description",
        expected: "",
    },
    {
        name: "parses literal block value",
        frontmatter: [
            "description: |",
            "  first line",
            "  second line",
        ].join("\n"),
        key: "description",
        expected: "first line\nsecond line",
    },
    {
        name: "preserves blank lines in literal block value",
        frontmatter: [
            "description: |",
            "  first line",
            "",
            "  third line",
        ].join("\n"),
        key: "description",
        expected: "first line\n\nthird line",
    },
    {
        name: "parses folded block value",
        frontmatter: [
            "description: >",
            "  first line",
            "  second line",
        ].join("\n"),
        key: "description",
        expected: "first line second line",
    },
    {
        name: "stops block parsing at next non-indented line",
        frontmatter: [
            "description: |",
            "  first line",
            "name: should-not-be-included",
            "  ignored trailing indent",
        ].join("\n"),
        key: "description",
        expected: "first line",
    },
    {
        name: "supports alternate keys",
        frontmatter: "name: demo-skill\ndescription: Demo text\n",
        key: "description",
        expected: "Demo text",
    },
    {
        name: "does not match similar prefix keys",
        frontmatter: "description_extra: nope\ndescription: yes\n",
        key: "description",
        expected: "yes",
    },
];

function run(): void {
    for (const testCase of valueCases) {
        const actual = extractFrontmatterValue(testCase.frontmatter, testCase.key ?? "description");
        assert.equal(
            actual,
            testCase.expected,
            `Failed value case: ${testCase.name}\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(testCase.expected)}`
        );
    }

    for (const testCase of arrayCases) {
        const actual = Array.from(extractFrontmatterStringArray(testCase.frontmatter, testCase.key ?? "required_secrets"));
        assert.deepEqual(
            actual,
            testCase.expected,
            `Failed array case: ${testCase.name}\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(testCase.expected)}`
        );
    }

    console.log(`Skill frontmatter helper tests passed: ${valueCases.length + arrayCases.length}`);
}

run();
