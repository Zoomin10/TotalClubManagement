// Explicit opt-in only. Creates one synthetic member; never changes an existing member.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { DateTime } = require("luxon");
async function main() {
  if (
    !process.argv.includes("--confirm-development-fixture") ||
    process.env.RETENTION_FIXTURE_ENVIRONMENT !== "development" ||
    !process.env.RETENTION_FIXTURE_DATABASE_URL
  )
    throw Error(
      "Set RETENTION_FIXTURE_ENVIRONMENT=development and RETENTION_FIXTURE_DATABASE_URL to your DEVELOPMENT database, then supply --confirm-development-fixture.",
    );
  if (process.env.NODE_ENV === "production")
    throw Error(
      "Run locally against an explicitly chosen development database, not from a production process.",
    );
  const db = new PrismaClient({
    datasources: { db: { url: process.env.RETENTION_FIXTURE_DATABASE_URL } },
  });
  try {
    const now = DateTime.now().setZone("Europe/London");
    const year = now.month >= 6 ? now.year - 1 : now.year - 2;
    const startsAt = DateTime.utc(year, 6, 1).toJSDate(),
      endsAt = DateTime.utc(year + 1, 6, 1).toJSDate();
    const id = "gdpr-archive-development-fixture";
    await db.$transaction(async (tx) => {
      if (await tx.consentForm.findUnique({ where: { id } }))
        throw Error(
          "Synthetic fixture already exists. Use its current state; this script never resets it.",
        );
      const season = await tx.clubSeason.upsert({
        where: { startYear: year },
        update: {},
        create: {
          startYear: year,
          label: `${year} / ${String(year + 1).slice(-2)}`,
          startsAt,
          endsAt,
          status: "DRAFT",
          termsVersion: "ARCHIVE-FIXTURE-ONLY",
          termsContent:
            "Synthetic expired-season fixture for development archive verification only.",
        },
      });
      await tx.consentForm.create({
        data: {
          id,
          createdAt: startsAt,
          ageGroup: "u9",
          wwfcTeam: "GDPR ARCHIVE TEST",
          playerFirstName: "Archive",
          playerSurname: "Test Fixture",
          playerDob: new Date("2017-01-01"),
          playerSex: "Female",
          emergencyContact1: {},
          emergencyContact2: {},
          postcode: "",
          houseNumber: "",
          email: "",
          medicalInfo: "",
          consentData: false,
          consentPhotos: false,
          consentVideos: false,
          parentSignature: "SYNTHETIC FIXTURE",
          parentName: "SYNTHETIC FIXTURE",
          signatureDate: startsAt,
          stripeSubscriptionStatus: "canceled",
          seasonMemberships: {
            create: {
              seasonId: season.id,
              state: "LEFT",
              origin: "NEW_REGISTRATION",
              acceptedAt: startsAt,
              firstPaymentDate: startsAt,
              leftAt: new Date(endsAt.getTime() - 86400000),
              billingStatus: "canceled",
            },
          },
        },
      });
    });
    console.log(
      "Created synthetic Archive Test Fixture in the explicitly selected development database. No Stripe customer, payment method, invoice or subscription was created.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
