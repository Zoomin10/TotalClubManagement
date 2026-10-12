const express = require("express");
const crypto = require("crypto");
const service = require("../services/volunteerService");
const { verifyTrudashAdmin } = require("../middleware/trudashAdmin");
const router = express.Router();
const include = { acceptances: true };
// Bound anonymous submission frequency. Reverse-proxy IPs are deliberately not trusted.
const attempts = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const key = req.ip; const value = attempts.get(key) || { count: 0, until: now + 60000 };
  if (value.count >= 30 || attempts.size >= 10000) return res.status(429).json({ error: "Please wait a minute before trying again." });
  value.count++; attempts.set(key, value); next();
}
router.get("/configuration", (req, res) => {
  res.set("Cache-Control", "no-store").json({ roles: service.roles, footballRoles: service.footballRoles, agreements: service.agreements() });
});
router.post("/", rateLimit, async (req, res) => {
  try {
    const parsed = service.signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please check your volunteer details.", details: parsed.error.flatten() });
    const { acceptances, ...data } = parsed.data;
    const accepted = service.acceptanceData(acceptances, data.requestedRoles);
    await service.prisma.clubVolunteer.create({ data: { ...data, team: data.team || null, assignedRoles: [], acceptances: { create: accepted } } });
    res.status(201).json({ success: true, message: "Thank you. The club will review your volunteer application." });
  } catch (e) {
    // Same response for duplicates, without exposing existing volunteer information.
    if (e.code === "P2002") return res.status(201).json({ success: true, message: "Thank you. The club will review your volunteer application. If you have already registered, contact the club to update your details." });
    console.error("Volunteer signup failed:", e.message);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : "Volunteer registration could not be saved." });
  }
});
async function tokenVolunteer(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  return service.prisma.clubVolunteer.findFirst({ where: { acceptanceTokenHash: service.hashToken(token), acceptanceTokenExpiresAt: { gt: new Date() } }, include });
}
router.get("/accept/:token", rateLimit, async (req, res) => {
  try {
    const volunteer = await tokenVolunteer(req.params.token);
    if (!volunteer) return res.status(404).json({ error: "This acceptance link has expired or was already used. Please contact the club." });
    res.set("Cache-Control", "no-store").json({ required: service.required([...volunteer.assignedRoles, ...volunteer.requestedRoles]), agreements: service.agreements() });
  } catch { res.status(500).json({ error: "Acceptance details could not be loaded." }); }
});
router.post("/accept/:token", rateLimit, async (req, res) => {
  try {
    await service.prisma.$transaction(async tx => {
      const token = req.params.token;
      if (!/^[a-f0-9]{64}$/.test(token || "")) throw Object.assign(new Error("Invalid acceptance link."), { statusCode: 404 });
      const v = await tx.clubVolunteer.findFirst({ where: { acceptanceTokenHash: service.hashToken(token), acceptanceTokenExpiresAt: { gt: new Date() } }, include });
      if (!v) throw Object.assign(new Error("This acceptance link has expired or was already used."), { statusCode: 404 });
      const docs = service.acceptanceData(req.body.acceptances, [...v.assignedRoles, ...v.requestedRoles]);
      const claimed = await tx.clubVolunteer.updateMany({ where: { id: v.id, acceptanceTokenHash: v.acceptanceTokenHash, acceptanceTokenExpiresAt: { gt: new Date() } }, data: { acceptanceTokenHash: null, acceptanceTokenExpiresAt: null } });
      if (!claimed.count) throw Object.assign(new Error("This acceptance link was already used."), { statusCode: 409 });
      for (const doc of docs) await tx.volunteerAcceptance.upsert({ where: { volunteerId_agreement_version: { volunteerId: v.id, agreement: doc.agreement, version: doc.version } }, create: { volunteerId: v.id, ...doc }, update: {} });
    }, { isolationLevel: "Serializable" });
    res.json({ success: true });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : "Acceptance could not be saved. Please retry." }); }
});
// Admin routes require the existing authenticated, signed TruDash bridge.
router.use("/admin", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!req.get("x-trudash-assertion")) return res.status(401).json({ error: "Sign in through TruDash" });
  if (verifyTrudashAdmin(req, res)) next();
});
router.get("/admin", async (req, res) => {
  try {
    const [volunteers, actor] = await Promise.all([
      service.prisma.clubVolunteer.findMany({ include, orderBy: { createdAt: "desc" } }),
      service.prisma.clubVolunteer.findUnique({ where: { email: req.trudashAdmin.username }, include }),
    ]);
    const superAdmin = req.trudashAdmin.volunteerSuperAdmin || (actor?.accessRole === "SUPER_ADMIN" && actor.status === "ACTIVE" && !service.currentAcceptances(actor).length);
    res.json({ volunteers: volunteers.map(service.summary), roles: service.roles, superAdmin: Boolean(superAdmin) });
  } catch { res.status(500).json({ error: "Volunteers could not be loaded." }); }
});
router.patch("/admin/:id", async (req, res) => {
  try {
    const parsed = service.updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid volunteer update." });
    const result = await service.prisma.$transaction(async tx => {
      const v = await tx.clubVolunteer.findUnique({ where: { id: req.params.id }, include });
      if (!v) throw Object.assign(new Error("Volunteer not found."), { statusCode: 404 });
      const actor = await tx.clubVolunteer.findUnique({ where: { email: req.trudashAdmin.username }, include });
      const superAdmin = req.trudashAdmin.volunteerSuperAdmin || (actor?.accessRole === "SUPER_ADMIN" && actor.status === "ACTIVE" && !service.currentAcceptances(actor).length);
      if ((parsed.data.accessRole !== v.accessRole || v.accessRole === "SUPER_ADMIN") && !superAdmin) throw Object.assign(new Error("Super Admin access is required to change this record or access permissions."), { statusCode: 403 });
      if (v.updatedAt.toISOString() !== parsed.data.updatedAt) throw Object.assign(new Error("This record has changed. Refresh before saving."), { statusCode: 409 });
      const { updatedAt, ...changes } = parsed.data;
      if (changes.status === "ACTIVE" && !changes.assignedRoles.length) throw Object.assign(new Error("Assign at least one club role before activation."), { statusCode: 409 });
      const updated = await tx.clubVolunteer.update({ where: { id: v.id }, data: changes, include });
      if (updated.status === "ACTIVE" && service.currentAcceptances(updated).length) throw Object.assign(new Error("Required agreements must be accepted before activation."), { statusCode: 409 });
      await tx.volunteerChange.create({ data: { volunteerId: v.id, actor: req.trudashAdmin.username, action: "UPDATED", details: { before: { assignedRoles: v.assignedRoles, accessRole: v.accessRole, status: v.status, notes: v.notes }, after: parsed.data } } });
      return service.summary(updated);
    }, { isolationLevel: "Serializable" });
    res.json(result);
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : "Volunteer update failed. Refresh and retry." }); }
});
router.post("/admin/:id/acceptance-link", async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString("hex");
    const root = new URL(process.env.FRONTEND_URL);
    if (root.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("Public URL must use HTTPS");
    await service.prisma.$transaction(async tx => {
      const v = await tx.clubVolunteer.findUnique({ where: { id: req.params.id } });
      if (!v) throw Object.assign(new Error("Volunteer not found."), { statusCode: 404 });
      await tx.clubVolunteer.update({ where: { id: v.id }, data: { acceptanceTokenHash: service.hashToken(token), acceptanceTokenExpiresAt: new Date(Date.now() + 30 * 86400000) } });
      await tx.volunteerChange.create({ data: { volunteerId: v.id, actor: req.trudashAdmin.username, action: "ACCEPTANCE_LINK_CREATED", details: {} } });
    });
    res.json({ url: new URL(`/volunteers/accept/${token}`, root).href });
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : "Acceptance link could not be created." }); }
});
module.exports = router;
