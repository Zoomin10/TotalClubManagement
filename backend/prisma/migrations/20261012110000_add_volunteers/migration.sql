-- CreateTable
CREATE TABLE "ClubVolunteer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "team" TEXT,
    "requestedRoles" JSONB NOT NULL,
    "assignedRoles" JSONB NOT NULL,
    "accessRole" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'AWAITING_REVIEW',
    "notes" TEXT NOT NULL DEFAULT '',
    "acceptanceTokenHash" TEXT,
    "acceptanceTokenExpiresAt" TIMESTAMP(3),

    CONSTRAINT "ClubVolunteer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerAcceptance" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "agreement" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerChange" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubVolunteer_email_key" ON "ClubVolunteer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClubVolunteer_acceptanceTokenHash_key" ON "ClubVolunteer"("acceptanceTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerAcceptance_volunteerId_agreement_version_key" ON "VolunteerAcceptance"("volunteerId", "agreement", "version");

-- CreateIndex
CREATE INDEX "VolunteerChange_volunteerId_createdAt_idx" ON "VolunteerChange"("volunteerId", "createdAt");

-- AddForeignKey
ALTER TABLE "VolunteerAcceptance" ADD CONSTRAINT "VolunteerAcceptance_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "ClubVolunteer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerChange" ADD CONSTRAINT "VolunteerChange_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "ClubVolunteer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
