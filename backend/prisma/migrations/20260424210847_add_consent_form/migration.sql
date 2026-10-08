-- CreateTable
CREATE TABLE "ConsentForm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ageGroup" TEXT NOT NULL,
    "playerFirstName" TEXT NOT NULL,
    "playerSurname" TEXT NOT NULL,
    "playerDob" TIMESTAMP(3) NOT NULL,
    "playerSex" TEXT NOT NULL,
    "emergencyContact1" JSONB NOT NULL,
    "emergencyContact2" JSONB NOT NULL,
    "postcode" TEXT NOT NULL,
    "houseNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "medicalInfo" TEXT NOT NULL,
    "allergies" TEXT,
    "photoUrl" TEXT,
    "consentData" BOOLEAN NOT NULL,
    "consentPhotos" BOOLEAN NOT NULL,
    "consentVideos" BOOLEAN NOT NULL,
    "parentSignature" TEXT NOT NULL,
    "parentName" TEXT NOT NULL,
    "signatureDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentForm_pkey" PRIMARY KEY ("id")
);
