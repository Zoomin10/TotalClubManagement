CREATE TABLE "ReportExportAudit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    CONSTRAINT "ReportExportAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReportExportAudit_createdAt_idx" ON "ReportExportAudit"("createdAt");
