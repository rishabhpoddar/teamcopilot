-- CreateTable
CREATE TABLE "chat_session_usage" (
    "chat_session_id" TEXT NOT NULL PRIMARY KEY,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cached_tokens" INTEGER NOT NULL,
    "cost_usd" REAL NOT NULL,
    "model_id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_session_usage_chat_session_id_fkey" FOREIGN KEY ("chat_session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
