const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../prisma");
const service = require("../services/retentionReview");
const { getStripe } = require("../services/stripeService");
router.use((req, res, next) => {
  if (!req.applicationAccess?.superAdmin)
    return res.status(403).json({ error: "Super Admin access required" });
  next();
});
const error = (res, e) => {
  if (!e.statusCode)
    console.error("Retention action failed:", e.code || e.name);
  res
    .status(e.statusCode || (e.code === "P2034" ? 409 : 500))
    .json({
      error: e.statusCode
        ? e.message
        : e.code === "P2034"
          ? "Record changed concurrently. Refresh and review before retrying."
          : "Retention action failed; refresh and check the result before retrying.",
    });
};
const reason = z.string().trim().min(10).max(300);
router.post("/:id/archive", async (req, res) => {
  const p = z
    .object({
      confirm: z.literal(true),
      nonRenewalConfirmed: z.literal(true),
      reason,
      reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({
        error:
          "Confirm non-renewal, provide a reason (10–300 characters), and choose an archive review date",
      });
  try {
    await service.archive(
      prisma,
      getStripe,
      req.params.id,
      req.trudashAdmin.username,
      p.data,
    );
    res.json({ success: true });
  } catch (e) {
    error(res, e);
  }
});
router.post("/:id/restore", async (req, res) => {
  const p = z.object({ confirm: z.literal(true), reason }).safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Confirmation and reason required" });
  try {
    await service.restore(
      prisma,
      req.params.id,
      req.trudashAdmin.username,
      p.data.reason,
    );
    res.json({
      success: true,
      message:
        "Record restored. Billing and renewal links have not been restarted.",
    });
  } catch (e) {
    error(res, e);
  }
});
router.post("/:id/hold", async (req, res) => {
  const p = z
    .object({ confirm: z.literal(true), enabled: z.boolean(), reason })
    .safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "Confirmation, hold setting and reason required" });
  try {
    await service.hold(
      prisma,
      req.params.id,
      req.trudashAdmin.username,
      p.data.enabled,
      p.data.reason,
    );
    res.json({ success: true });
  } catch (e) {
    error(res, e);
  }
});
router.post("/:id/review", async (req, res) => {
  const p = z
    .object({
      confirm: z.literal(true),
      reason,
      reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "Confirmation, review date and justification required" });
  try {
    await service.review(
      prisma,
      req.params.id,
      req.trudashAdmin.username,
      p.data,
    );
    res.json({ success: true });
  } catch (e) {
    error(res, e);
  }
});
module.exports = router;
