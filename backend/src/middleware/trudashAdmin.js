const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const seen = new Map();

// Only server-signed assertions are trusted; browser identity headers are not.
function verifyTrudashAdmin(req, res) {
  const assertion = req.get("x-trudash-assertion");
  if (!assertion) return false;
  try {
    const secret = process.env.TRUDASH_MEMBERSHIP_SHARED_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Bridge not configured");
    const claims = jwt.verify(assertion, secret, {
      algorithms: ["HS256"], issuer: "trudash", audience: "tcm-membership-admin",
      maxAge: "30s", clockTolerance: 2,
    });
    const hash = crypto.createHash("sha256").update(JSON.stringify(req.body || null)).digest("hex");
    if (claims.role !== "membership_admin" || typeof claims.sub !== "string" ||
        claims.method !== req.method || claims.path !== req.originalUrl || claims.bodyHash !== hash ||
        typeof claims.jti !== "string" || !Number.isInteger(claims.exp)) {
      throw new Error("Invalid bridge claims");
    }
    const now = Math.floor(Date.now() / 1000);
    for (const [id, expiry] of seen) if (expiry + 2 < now) seen.delete(id);
    if (seen.has(claims.jti) || seen.size >= 10000) throw new Error("Invalid or replayed assertion");
    seen.set(claims.jti, claims.exp);
    req.trudashAdmin = { username: claims.sub, volunteerSuperAdmin: claims.volunteerSuperAdmin === true, fullCsvExport: claims.fullCsvExport === true };
    return true;
  } catch {
    res.status(401).json({ error: "Invalid or expired TruDash authorization" });
    return false;
  }
}
module.exports = { verifyTrudashAdmin };
