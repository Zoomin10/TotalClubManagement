-- AlterTable
ALTER TABLE "ConsentForm" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archiveReviewAt" TIMESTAMP(3),
ADD COLUMN     "archiveSeasonId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "retentionHoldAt" TIMESTAMP(3),
ADD COLUMN     "retentionHoldReason" TEXT;

-- CreateTable
CREATE TABLE "MemberRetentionAudit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "MemberRetentionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberRetentionAudit_registrationId_createdAt_idx" ON "MemberRetentionAudit"("registrationId", "createdAt");
