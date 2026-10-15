-- AlterTable
ALTER TABLE "MembershipInvoice" ADD COLUMN     "seasonMembershipId" TEXT;

-- CreateTable
CREATE TABLE "ClubSeason" (
    "id" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "termsVersion" TEXT NOT NULL,
    "termsContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPlan" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "paymentPlan" "PaymentPlan" NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "stripePriceId" TEXT NOT NULL,

    CONSTRAINT "SeasonPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonMembership" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "paymentPlan" "PaymentPlan",
    "amountPence" INTEGER,
    "stripePriceId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OFFERED',
    "origin" TEXT NOT NULL DEFAULT 'RENEWAL',
    "firstPaymentDate" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "termsVersion" TEXT,
    "termsContent" TEXT,
    "permissions" JSONB,
    "medicalConsent" BOOLEAN NOT NULL DEFAULT false,
    "leftAt" TIMESTAMP(3),
    "stripeScheduleId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "billingStatus" TEXT,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "seasonId" TEXT,
    "registrationId" TEXT,
    "details" JSONB NOT NULL,

    CONSTRAINT "SeasonChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubSeason_startYear_key" ON "ClubSeason"("startYear");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonPlan_seasonId_paymentPlan_key" ON "SeasonPlan"("seasonId", "paymentPlan");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_stripeScheduleId_key" ON "SeasonMembership"("stripeScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_stripeSubscriptionId_key" ON "SeasonMembership"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_stripeCheckoutSessionId_key" ON "SeasonMembership"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_tokenHash_key" ON "SeasonMembership"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_registrationId_seasonId_key" ON "SeasonMembership"("registrationId", "seasonId");

-- CreateIndex
CREATE INDEX "SeasonChange_createdAt_idx" ON "SeasonChange"("createdAt");

-- AddForeignKey
ALTER TABLE "MembershipInvoice" ADD CONSTRAINT "MembershipInvoice_seasonMembershipId_fkey" FOREIGN KEY ("seasonMembershipId") REFERENCES "SeasonMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPlan" ADD CONSTRAINT "SeasonPlan_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ClubSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonMembership" ADD CONSTRAINT "SeasonMembership_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ConsentForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonMembership" ADD CONSTRAINT "SeasonMembership_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ClubSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

