-- CreateTable
CREATE TABLE "MembershipInvoice" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "currency" TEXT NOT NULL,
    "amountDuePence" INTEGER NOT NULL,
    "amountPaidPence" INTEGER NOT NULL,
    "amountRemainingPence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentFailedAt" TIMESTAMP(3),
    "nextPaymentAttemptAt" TIMESTAMP(3),
    "invoiceCreatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipInvoice_stripeInvoiceId_key" ON "MembershipInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "MembershipInvoice_registrationId_invoiceCreatedAt_idx" ON "MembershipInvoice"("registrationId", "invoiceCreatedAt");

-- AddForeignKey
ALTER TABLE "MembershipInvoice" ADD CONSTRAINT "MembershipInvoice_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ConsentForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
