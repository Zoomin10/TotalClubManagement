const express = require("express");
const { z } = require("zod");
const crypto = require("node:crypto");
const prisma = require("../prisma");
const service = require("../services/seasons");
const { getStripe } = require("../services/stripeService");
const { verifyTrudashAdmin } = require("../middleware/trudashAdmin");
const { applicationAccess } = require("../services/applicationPermissions");
const router = express.Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  next();
});
const sendError = (res, e) => {
  if (!e.statusCode) console.error("Season action failed:", e.code || e.name);
  return res.status(e.statusCode || (e.code === "P2002" ? 409 : 500)).json({
    error: e.statusCode
      ? e.message
      : e.code === "P2002"
        ? "A season or membership with these details already exists. Refresh the page."
        : "Season action failed. Check the server log and retry safely.",
  });
};
// Per-instance cap bounds token probing and anonymous writes without trusting proxy IP headers.
const attempts = new Map();
router.use((req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const value = attempts.get(key) || { count: 0, until: now + 60000 };
  if (value.count >= 120 || attempts.size >= 10000)
    return res
      .status(429)
      .json({ error: "Please wait a minute before retrying" });
  value.count++;
  attempts.set(key, value);
  next();
});
router.get("/offer", async (req, res) => {
  try {
    res.json({
      enabled: process.env.SEASON_MEMBERSHIP_ENABLED === "true",
      offer: await service.newOffer(),
    });
  } catch (e) {
    sendError(res, e);
  }
});
async function tokenMembership(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  return prisma.seasonMembership.findFirst({
    where: {
      tokenHash: service.hash(token),
      tokenExpiresAt: { gt: new Date() },
    },
    include: service.include,
  });
}
const safeContact = (c) =>
  Object.fromEntries(
    [
      "name",
      "email",
      "phoneNumber",
      "postcode",
      "houseNumber",
      "relationship",
    ].map((k) => [k, c?.[k] || ""]),
  );
router.get("/renew/:token", async (req, res) => {
  try {
    const m = await tokenMembership(req.params.token);
    if (!m || m.leftAt || m.registration.archivedAt)
      throw service.fail("This renewal link is unavailable or expired", 404);
    if (m.state === "ACCEPTED")
      return res.json({
        accepted: true,
        season: service.publicSeason(m.season),
        paymentSetupRequired: !m.stripeScheduleId,
      });
    res.json({
      season: service.publicSeason(m.season),
      player: {
        firstName: m.registration.playerFirstName,
        surname: m.registration.playerSurname,
        team: m.registration.wwfcTeam,
      },
      contacts: [
        safeContact(m.registration.emergencyContact1),
        safeContact(m.registration.emergencyContact2),
      ],
    });
  } catch (e) {
    sendError(res, e);
  }
});
const contact = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(150),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^(\+44|0)[\d\s()-]{9,18}$/),
  postcode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/),
  houseNumber: z.string().trim().min(1).max(50),
  relationship: z.enum(["Mother", "Father", "Carer"]),
});
const renewalSchema = z
  .object({
    paymentPlan: z.enum(["MATCHES_AND_TRAINING", "TRAINING_ONLY"]),
    parentName: z.string().trim().min(1).max(100),
    contacts: z.array(contact).length(2),
    medicalInfo: z.string().trim().max(1000),
    allergies: z.string().trim().max(1000),
    medicalReviewed: z.literal(true),
    medicalConsent: z.boolean(),
    consentData: z.boolean(),
    consentPhotos: z.boolean(),
    consentVideos: z.boolean(),
    consentWalkHome: z.boolean().nullable(),
    detailsConfirmed: z.literal(true),
    agreementAccepted: z.literal(true),
  })
  .refine((d) => !(d.medicalInfo || d.allergies) || d.medicalConsent, {
    message:
      "Separate explicit medical-data consent is required for declared health information",
    path: ["medicalConsent"],
  });
router.post("/renew/:token", async (req, res) => {
  try {
    const parsed = renewalSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Check the renewal details, agreement and medical-data consent",
        details: parsed.error.flatten(),
      });
    const d = parsed.data;
    const m = await tokenMembership(req.params.token);
    if (!m || m.leftAt || m.registration.archivedAt) throw service.fail("Renewal link unavailable", 404);
    if (m.state !== "OFFERED")
      throw service.fail("Renewal already accepted. Use Resume payment setup.");
    if (m.season.status !== "PUBLISHED" || m.season.startsAt <= new Date())
      throw service.fail(
        "Renewal deadline passed; contact the club. No immediate payment will be taken.",
      );
    const plan = m.season.plans.find((p) => p.paymentPlan === d.paymentPlan);
    if (!plan) throw service.fail("Plan unavailable");
    await service.checkPrice(getStripe(), plan.stripePriceId, plan.amountPence);
    await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.seasonMembership.updateMany({
          where: {
            id: m.id,
            state: "OFFERED",
            leftAt: null,
            tokenHash: m.tokenHash,
            tokenExpiresAt: { gt: new Date() },
          },
          data: {
            state: "ACCEPTED",
            paymentPlan: d.paymentPlan,
            amountPence: plan.amountPence,
            stripePriceId: plan.stripePriceId,
            firstPaymentDate: m.season.startsAt,
            acceptedAt: new Date(),
            acceptedBy: d.parentName,
            termsVersion: m.season.termsVersion,
            termsContent: m.season.termsContent,
            permissions: {
              consentData: d.consentData,
              consentPhotos: d.consentPhotos,
              consentVideos: d.consentVideos,
              consentWalkHome: d.consentWalkHome,
            },
            medicalConsent: d.medicalConsent,
          },
        });
        if (!claimed.count)
          throw service.fail("Renewal changed or already accepted");
        const updated=await tx.consentForm.updateMany({
          where: { id: m.registrationId, archivedAt:null },
          data: {
            emergencyContact1: {
              ...m.registration.emergencyContact1,
              ...d.contacts[0],
            },
            emergencyContact2: {
              ...m.registration.emergencyContact2,
              ...d.contacts[1],
            },
            medicalInfo: d.medicalInfo,
            allergies: d.allergies || null,
            consentData: d.consentData,
            consentPhotos: d.consentPhotos,
            consentVideos: d.consentVideos,
            consentWalkHome: d.consentWalkHome,
            parentName: d.parentName,
            parentSignature: d.parentName,
            signatureDate: new Date(),
          },
        });
        if(!updated.count)throw service.fail("This membership is archived. Contact the club.");
        await tx.seasonChange.create({
          data: {
            actor: "parent-renewal",
            action: "RENEWAL_ACCEPTED",
            seasonId: m.seasonId,
            registrationId: m.registrationId,
            details: {
              membershipId: m.id,
              termsVersion: m.season.termsVersion,
              paymentPlan: d.paymentPlan,
              amountPence: plan.amountPence,
            },
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    let checkoutUrl = null;
    let setupError = null;
    try {
      checkoutUrl = await service.checkout(m.id);
    } catch (e) {
      setupError = e.statusCode
        ? e.message
        : "Payment setup could not start; contact the club or resume setup.";
    }
    res.status(201).json({ accepted: true, checkoutUrl, setupError });
  } catch (e) {
    sendError(res, e);
  }
});
router.post("/renew/:token/checkout", async (req, res) => {
  try {
    const m = await tokenMembership(req.params.token);
    if (!m) throw service.fail("Link expired; contact the club", 404);
    res.json({ checkoutUrl: await service.checkout(m.id) });
  } catch (e) {
    sendError(res, e);
  }
});
router.use("/admin", async (req, res, next) => {
  if (!req.get("x-trudash-assertion"))
    return res
      .status(401)
      .json({ error: "Microsoft sign-in through TruDash required" });
  if (!verifyTrudashAdmin(req, res)) return;
  try {
    const access = await applicationAccess(req.trudashAdmin);
    if (!access.permissions.includes("MEMBERS_MANAGE"))
      return res.status(403).json({ error: "Membership management required" });
    req.seasonAccess = access;
    next();
  } catch {
    res.status(503).json({ error: "Permissions could not be checked" });
  }
});
router.get("/admin", async (req, res) => {
  try {
    const seasons = await prisma.clubSeason.findMany({
      include: { plans: true },
      orderBy: { startYear: "desc" },
    });
    const memberships = await prisma.seasonMembership.findMany({
      where:{registration:{archivedAt:null}},
      select: {
        id: true,
        seasonId: true,
        registrationId: true,
        state: true,
        origin: true,
        paymentPlan: true,
        amountPence: true,
        firstPaymentDate: true,
        billingStatus: true,
        acceptedAt: true,
        leftAt: true,
        registration: {
          select: {
            playerFirstName: true,
            playerSurname: true,
            wwfcTeam: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      seasons,
      memberships,
      canConfigure: req.seasonAccess.superAdmin === true,
      enabled: process.env.SEASON_MEMBERSHIP_ENABLED === "true",
    });
  } catch (e) {
    sendError(res, e);
  }
});
const configSchema = z
  .object({
    startYear: z.number().int().min(2026).max(2100),
    termsVersion: z.string().trim().min(1).max(60),
    termsContent: z.string().trim().min(20).max(15000),
    plans: z
      .array(
        z.object({
          paymentPlan: z.enum(["MATCHES_AND_TRAINING", "TRAINING_ONLY"]),
          amountPence: z.number().int().positive().max(100000),
          stripePriceId: z.string().regex(/^price_[A-Za-z0-9]+$/),
        }),
      )
      .length(2),
  })
  .refine((d) => new Set(d.plans.map((p) => p.paymentPlan)).size === 2);
router.post("/admin", async (req, res) => {
  try {
    if (!req.seasonAccess.superAdmin)
      throw service.fail("Super Admin required", 403);
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Provide a year, terms and both plans in pence" });
    const d = parsed.data;
    const stripe = getStripe();
    for (const p of d.plans)
      await service.checkPrice(stripe, p.stripePriceId, p.amountPence);
    const season = await prisma.$transaction(async (tx) => {
      const s = await tx.clubSeason.create({
        data: {
          startYear: d.startYear,
          label: `${d.startYear} / ${String(d.startYear + 1).slice(-2)}`,
          ...service.dates(d.startYear),
          termsVersion: d.termsVersion,
          termsContent: d.termsContent,
          plans: { create: d.plans },
        },
      });
      await tx.seasonChange.create({
        data: {
          actor: req.trudashAdmin.username,
          action: "SEASON_CREATED",
          seasonId: s.id,
          details: { startYear: d.startYear },
        },
      });
      return s;
    });
    res.status(201).json({ season });
  } catch (e) {
    sendError(res, e);
  }
});
router.post("/admin/:seasonId/publish", async (req, res) => {
  try {
    if (!req.seasonAccess.superAdmin || req.body.confirm !== true)
      throw service.fail("Super Admin confirmation required", 403);
    const s = await prisma.clubSeason.findUnique({
      where: { id: req.params.seasonId },
      include: { plans: true },
    });
    if (!s || s.status !== "DRAFT")
      throw service.fail("Draft season not found");
    for (const p of s.plans)
      await service.checkPrice(getStripe(), p.stripePriceId, p.amountPence);
    await prisma.$transaction(async (tx) => {
      const changed = await tx.clubSeason.updateMany({
        where: { id: s.id, status: "DRAFT" },
        data: { status: "PUBLISHED" },
      });
      if (!changed.count) throw service.fail("Season changed");
      await tx.seasonChange.create({
        data: {
          actor: req.trudashAdmin.username,
          action: "SEASON_PUBLISHED",
          seasonId: s.id,
          details: { termsVersion: s.termsVersion },
        },
      });
    });
    res.json({ success: true });
  } catch (e) {
    sendError(res, e);
  }
});
router.post(
  "/admin/:seasonId/members/:registrationId/renewal-link",
  async (req, res) => {
    try {
      const s = await prisma.clubSeason.findUnique({
        where: { id: req.params.seasonId },
        include: { plans: true },
      });
      if (!s || s.status !== "PUBLISHED" || s.startsAt <= new Date())
        throw service.fail("Choose a published future season");
      const r = await prisma.consentForm.findUnique({
        where: { id: req.params.registrationId },
      });
      if (!r || r.archivedAt) throw service.fail("Active member not found", 404);
      const token = crypto.randomBytes(32).toString("hex");
      const m = await prisma.$transaction(async (tx) => {
        const existing = await tx.seasonMembership.findUnique({
          where: {
            registrationId_seasonId: { registrationId: r.id, seasonId: s.id },
          },
        });
        if (existing && existing.state !== "OFFERED")
          throw service.fail(
            "This member already accepted or left that season",
          );
        const data = {
          tokenHash: service.hash(token),
          tokenExpiresAt: new Date(
            Math.min(Date.now() + 30 * 86400000, s.startsAt.getTime()),
          ),
        };
        const result = await tx.seasonMembership.upsert({
          where: {
            registrationId_seasonId: { registrationId: r.id, seasonId: s.id },
          },
          create: { registrationId: r.id, seasonId: s.id, ...data },
          update: data,
        });
        await tx.seasonChange.create({
          data: {
            actor: req.trudashAdmin.username,
            action: "RENEWAL_LINK_CREATED",
            seasonId: s.id,
            registrationId: r.id,
            details: { membershipId: result.id },
          },
        });
        return result;
      });
      const root = new URL(process.env.FRONTEND_URL);
      if (process.env.NODE_ENV === "production" && root.protocol !== "https:")
        throw service.fail("Public URL must use HTTPS", 503);
      res.json({
        url: new URL(`/renew/${token}`, root).href,
        expiresAt: m.tokenExpiresAt,
      });
    } catch (e) {
      sendError(res, e);
    }
  },
);
router.post(
  "/admin/:seasonId/members/:registrationId/end-legacy",
  async (req, res) => {
    try {
      if (req.body.confirm !== true)
        throw service.fail("Confirmation required", 400);
      const s = await prisma.clubSeason.findUnique({
        where: { id: req.params.seasonId },
      });
      const r = await prisma.consentForm.findUnique({
        where: { id: req.params.registrationId },
      });
      if (!s || !r || r.archivedAt || s.startsAt > new Date())
        throw service.fail("Choose this member’s current season");
      res.json(await service.endLegacy(r, s, req.trudashAdmin.username));
    } catch (e) {
      sendError(res, e);
    }
  },
);
router.post("/admin/members/:registrationId/leave", async (req, res) => {
  try {
    if (req.body.confirm !== true)
      throw service.fail("Confirmation required", 400);
    const count = await service.leaveAll(
      req.params.registrationId,
      req.trudashAdmin.username,
    );
    res.json({
      success: true,
      count,
      message:
        "All recorded current and future plans cancelled. Registration and past invoices retained.",
    });
  } catch (e) {
    sendError(res, e);
  }
});
router.post(
  "/admin/memberships/:membershipId/payment-setup",
  async (req, res) => {
    try {
      res.json({
        checkoutUrl: await service.checkout(req.params.membershipId),
      });
    } catch (e) {
      sendError(res, e);
    }
  },
);
module.exports = router;
