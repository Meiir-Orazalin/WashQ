/*
  Warnings:

  - A unique constraint covering the columns `[replaced_by_session_id]` on the table `refresh_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "refresh_sessions" ADD COLUMN     "family_id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "replaced_by_session_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_session_id_key" ON "refresh_sessions"("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_family_id_revoked_at_idx" ON "refresh_sessions"("family_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
