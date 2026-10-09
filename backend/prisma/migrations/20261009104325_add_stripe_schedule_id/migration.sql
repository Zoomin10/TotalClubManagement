/*
  Warnings:

  - A unique constraint covering the columns `[stripeScheduleId]` on the table `ConsentForm` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ConsentForm" ADD COLUMN     "stripeScheduleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ConsentForm_stripeScheduleId_key" ON "ConsentForm"("stripeScheduleId");
