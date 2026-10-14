const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../prisma");
const roles = ["Trustee", "Committee Member", "Chair", "Vice-Chair", "Welfare Officer", "Treasurer", "Club Secretary", "Team Manager", "Team Coach", "Assistant Coach", "Team Secretary",  "Marketing", "Events", "Social Media Manager", "Social Impact Manager", "Fundraising Manager", "Facility Liaison Manager"];
const footballRoles = ["Team Manager", "Team Coach", "Assistant Coach"];
const roleSchema = z.array(z.enum(roles)).max(roles.length).refine(a => new Set(a).size === a.length, "Duplicate roles");
const publishedAgreements = require("../content/volunteerAgreements.json");
function agreements() {
  return publishedAgreements.map(doc => {
    const prefix = doc.key === "VOLUNTEER" ? "VOLUNTEER_AGREEMENT" : "COACH_CODE";
    const version = process.env[`${prefix}_VERSION`];
    const content = process.env[`${prefix}_TEXT`];
    // Legacy deployments may override both values. A partial override fails closed.
    if (version !== undefined || content !== undefined) {
      return version?.trim() && content?.trim()
        ? { key: doc.key, title: doc.title, version, content }
        : null;
    }
    return doc;
  }).filter(Boolean);
}

function required(rolesSelected) { return ["VOLUNTEER", ...(rolesSelected.some(r => footballRoles.includes(r)) ? ["COACH"] : [])]; }
function currentAcceptances(volunteer) {
  const docs = agreements();
  return required([...(volunteer.assignedRoles || []), ...(volunteer.requestedRoles || [])]).filter(key => {
    const doc = docs.find(d => d.key === key);
    return !doc || !volunteer.acceptances.some(a => a.agreement === key && a.version === doc.version && a.content === doc.content);
  });
}
function summary(v) {
  const { acceptanceTokenHash, acceptanceTokenExpiresAt, ...safe } = v;
  const missingAgreements = currentAcceptances(v);
  return { ...safe, missingAgreements, onboardingStatus: v.status === "INACTIVE" ? "Inactive" : missingAgreements.length ? "Acceptance required" : v.status === "ACTIVE" ? "Active" : "Awaiting review" };
}
function acceptanceData(submitted, selectedRoles) {
  const docs = agreements();
  return required(selectedRoles).map(key => {
    const doc = docs.find(d => d.key === key);
    if (!doc) { const e = new Error("The club has not published all required agreements yet."); e.statusCode = 503; throw e; }
    if (submitted?.[key] !== doc.version) { const e = new Error("Please read and accept the current agreements."); e.statusCode = 400; throw e; }
    return { agreement: key, version: doc.version, content: doc.content };
  });
}
const signupSchema = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).transform(s => s.toLowerCase()),
  phone: z.string().trim().min(7).max(30).regex(/^[+\d\s()-]+$/), team: z.string().trim().max(100).default(""),
  requestedRoles: roleSchema.min(1), acceptances: z.record(z.string(), z.string()),
});
const applicationPermissionKeys = ["MEMBERS_MANAGE", "VOLUNTEERS_MANAGE", "FINANCE_DETAILS", "WELFARE_DETAILS", "SOURCE_REPORTS", "FULL_CSV_EXPORT"];
const updateSchema = z.object({ applicationPermissions: z.array(z.enum(applicationPermissionKeys)).max(applicationPermissionKeys.length).refine(p => new Set(p).size === p.length, "Duplicate permissions").optional(), updatedAt: z.string().datetime(), assignedRoles: roleSchema, status: z.enum(["AWAITING_REVIEW", "ACTIVE", "INACTIVE"]), notes: z.string().trim().max(4000), accessRole: z.enum(["NONE", "ADMIN", "SUPER_ADMIN"]) });
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
module.exports = { roles, footballRoles, agreements, required, currentAcceptances, summary, acceptanceData, signupSchema, updateSchema, hashToken, prisma };
