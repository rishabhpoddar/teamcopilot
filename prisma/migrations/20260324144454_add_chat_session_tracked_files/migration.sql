-- CreateTable
CREATE TABLE "chat_session_tracked_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chat_session_id" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "existed_at_baseline" BOOLEAN NOT NULL,
    "content_kind" TEXT NOT NULL,
    "text_content" TEXT,
    "binary_content" BLOB,
    "size_bytes" INTEGER,
    "content_sha256" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "chat_session_tracked_files_chat_session_id_fkey" FOREIGN KEY ("chat_session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "chat_session_tracked_files_chat_session_id_idx" ON "chat_session_tracked_files"("chat_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_session_tracked_files_chat_session_id_relative_path_key" ON "chat_session_tracked_files"("chat_session_id", "relative_path");
