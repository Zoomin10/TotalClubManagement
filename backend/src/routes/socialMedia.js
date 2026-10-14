const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { verifyTrudashAdmin } = require("../middleware/trudashAdmin");
const { normalisePostUrl } = require("../services/socialMediaService");
const router = express.Router();
router.use(async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!req.get("x-trudash-assertion")) return res.status(401).json({ error: "Sign in through TruDash" });
  if (!verifyTrudashAdmin(req, res)) return;
  try {
    const access = await require("../services/applicationPermissions").applicationAccess(req.trudashAdmin);
    if (!access.permissions.includes("MEMBERS_MANAGE")) return res.status(403).json({error:"Social media administration access required"});
    next();
  } catch { res.status(503).json({error:"Application permissions could not be checked"}); }
});
router.get("/", async (req, res) => {
  try {
    const posts = await prisma.socialMediaPost.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ posts });
  } catch { res.status(500).json({ error: "Social media posts could not be loaded." }); }
});
router.post("/", async (req, res) => {
  const parsed = z.object({ url: z.string().trim().min(1).max(2000), title: z.string().trim().max(150).default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the post URL and title." });
  let details;
  try { details = normalisePostUrl(parsed.data.url); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const post = await prisma.socialMediaPost.upsert({ where: { url: details.url }, update: {}, create: { ...details, title: parsed.data.title, createdBy: req.trudashAdmin.username } });
    res.json(post);
  } catch { res.status(500).json({ error: "The post link could not be saved." }); }
});
router.delete("/:id", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "Removal confirmation is required." });
  try { await prisma.socialMediaPost.delete({ where: { id: req.params.id } }); res.json({ success: true }); }
  catch (error) { res.status(error.code === "P2025" ? 404 : 500).json({ error: error.code === "P2025" ? "Post link not found." : "The post link could not be removed." }); }
});
module.exports = router;
