-- CreateIndex
CREATE INDEX "chat_sessions_user_id_visible_to_user_updated_at_idx" ON "chat_sessions"("user_id", "visible_to_user", "updated_at");
