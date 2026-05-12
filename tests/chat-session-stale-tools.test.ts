import assert from "node:assert/strict";
import { normalizeStaleRunningTools, type SessionMessageWire } from "../src/utils/chat-session";

function main(): void {
    const messages: SessionMessageWire[] = [
        {
            info: { id: "msg-1" },
            parts: [
                {
                    id: "tool-running",
                    type: "tool",
                    tool: "bash",
                    messageID: "msg-1",
                    state: {
                        status: "running",
                        input: { command: "npm test" },
                        metadata: { key: "value" },
                        time: { start: 123 },
                    },
                },
                {
                    id: "tool-pending",
                    type: "tool",
                    tool: "question",
                    messageID: "msg-1",
                    state: {
                        status: "pending",
                        input: { question: "Continue?" },
                        time: { start: 456 },
                    },
                },
                {
                    id: "tool-complete",
                    type: "tool",
                    tool: "bash",
                    messageID: "msg-1",
                    state: {
                        status: "completed",
                        input: {},
                        time: { start: 1, end: 2 },
                    },
                },
                {
                    id: "text-1",
                    type: "text",
                    messageID: "msg-1",
                },
            ],
        },
    ];

    const busyResult = normalizeStaleRunningTools(messages, "busy");
    assert.equal(busyResult, messages, "Busy sessions should return the original message array unchanged");

    const retryResult = normalizeStaleRunningTools(messages, "retry");
    assert.equal(retryResult, messages, "Retry sessions should return the original message array unchanged");

    const idleResult = normalizeStaleRunningTools(messages, "idle");
    assert.notEqual(idleResult, messages);
    const idleParts = idleResult[0].parts;
    const runningPart = idleParts[0] as Extract<(typeof idleParts)[number], { type: "tool" }>;
    const pendingPart = idleParts[1] as Extract<(typeof idleParts)[number], { type: "tool" }>;
    const completePart = idleParts[2] as Extract<(typeof idleParts)[number], { type: "tool" }>;
    assert.equal(runningPart.state.status, "error");
    assert.equal(runningPart.state.error, "Tool call interrupted");
    assert.equal(runningPart.state.time?.start, 123);
    assert.equal(typeof runningPart.state.time?.end, "number");
    assert.deepEqual(runningPart.state.metadata, { key: "value" });
    assert.equal(pendingPart.state.status, "error");
    assert.equal(pendingPart.state.error, "Tool call interrupted");
    assert.equal(pendingPart.state.time?.start, 456);
    assert.equal(completePart.state.status, "completed");
    assert.equal(idleParts[3].type, "text");

    assert.throws(
        () => normalizeStaleRunningTools([
            {
                info: { id: "msg-missing-start" },
                parts: [
                    {
                        id: "tool-missing-start",
                        type: "tool",
                        tool: "bash",
                        messageID: "msg-missing-start",
                        state: {
                            status: "running",
                            input: {},
                        },
                    },
                ],
            },
        ], "idle"),
        /Missing tool start time/,
    );

    console.log("Chat session stale tool tests passed");
}

main();
