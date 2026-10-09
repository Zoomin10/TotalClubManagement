/*
  Warnings:

  - A unique constraint covering the columns `[stripeSubscriptionId]` on the table `ConsentForm` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeCheckoutSessionId]` on the table `ConsentForm` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('MATCHES_AND_TRAINING', 'TRAINING_ONLY');

-- AlterTable
ALTER TABLE "ConsentForm" ADD COLUMN     "firstPaymentDate" TIMESTAMP(3),
ADD COLUMN     "monthlyAmountPence" INTEGER,
ADD COLUMN     "paymentPlan" "PaymentPlan",
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripeSubscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ConsentForm_stripeSubscriptionId_key" ON "ConsentForm"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentForm_stripeCheckoutSessionId_key" ON "ConsentForm"("stripeCheckoutSessionId");
