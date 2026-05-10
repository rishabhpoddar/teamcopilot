import assert from "node:assert/strict";
import { sessionHasPendingInputForLatestAssistantMessage } from "../src/utils/chat-session";

function main(): void {
    const opencodeSessionId = "ses-current";
    const latestAssistantMessageId = "msg-latest";

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId,
            pendingQuestions: [
                {
                    sessionID: opencodeSessionId,
                    tool: {
                        messageID: latestAssistantMessageId
                    }
                }
            ],
            pendingPermissions: [],
            customPendingPermissions: []
        }),
        true,
        "Pending OpenCode questions should match through tool.messageID"
    );

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId,
            pendingQuestions: [
                {
                    sessionID: opencodeSessionId,
                    messageID: latestAssistantMessageId
                } as unknown as { sessionID: string; tool?: { messageID: string } }
            ],
            pendingPermissions: [],
            customPendingPermissions: []
        }),
        false,
        "Top-level messageID should not be treated as the pending question contract"
    );

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId,
            pendingQuestions: [
                {
                    sessionID: opencodeSessionId,
                    tool: {
                        messageID: "msg-older"
                    }
                }
            ],
            pendingPermissions: [],
            customPendingPermissions: []
        }),
        false,
        "Pending questions on older assistant messages should not mark the latest message as attention"
    );

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId,
            pendingQuestions: [],
            pendingPermissions: [
                {
                    sessionID: opencodeSessionId,
                    tool: {
                        messageID: latestAssistantMessageId
                    }
                }
            ],
            customPendingPermissions: []
        }),
        true,
        "Pending OpenCode permissions should still match through tool.messageID"
    );

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId,
            pendingQuestions: [],
            pendingPermissions: [],
            customPendingPermissions: [
                {
                    opencode_session_id: opencodeSessionId,
                    message_id: latestAssistantMessageId
                }
            ]
        }),
        true,
        "Pending custom permissions should still match through message_id"
    );

    assert.equal(
        sessionHasPendingInputForLatestAssistantMessage({
            opencodeSessionId,
            latestAssistantMessageId: null,
            pendingQuestions: [
                {
                    sessionID: opencodeSessionId,
                    tool: {
                        messageID: latestAssistantMessageId
                    }
                }
            ],
            pendingPermissions: [],
            customPendingPermissions: []
        }),
        false,
        "Sessions without a latest assistant message should not be marked as pending input"
    );

    console.log("Chat session pending input tests passed");
}

main();
