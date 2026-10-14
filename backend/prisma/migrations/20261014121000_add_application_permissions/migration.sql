ALTER TABLE "ClubVolunteer" ADD COLUMN "applicationPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "ClubVolunteer" SET "applicationPermissions" = ARRAY['VOLUNTEERS_MANAGE']::TEXT[] WHERE "accessRole" IN ('ADMIN', 'SUPER_ADMIN');
