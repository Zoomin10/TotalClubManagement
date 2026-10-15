const { DateTime } = require("luxon");
const zone = "Europe/London";
const fail = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const selection = {
  id: true,
  createdAt: true,
  playerFirstName: true,
  playerSurname: true,
  wwfcTeam: true,
  archivedAt: true,
  archiveSeasonId: true,
  archiveReason: true,
  archiveReviewAt: true,
  retentionHoldAt: true,
  retentionHoldReason: true,
  stripeCustomerId: true,
  stripeScheduleId: true,
  stripeSubscriptionId: true,
  stripeSubscriptionStatus: true,
  seasonMemberships: {
    select: {
      id: true,
      state: true,
      origin: true,
      leftAt: true,
      acceptedAt: true,
      firstPaymentDate: true,
      billingStatus: true,
      stripeScheduleId: true,
      stripeSubscriptionId: true,
      season: {
        select: { id: true, label: true, startsAt: true, endsAt: true },
      },
    },
  },
  _count: {
    select: {
      invoices: { where: { status: "open", amountRemainingPence: { gt: 0 } } },
    },
  },
};
function facts(record, now = new Date()) {
  const confirmed = (record.seasonMemberships || [])
    .filter(
      (m) =>
        (m.state === "ACCEPTED" || m.state === "LEFT") &&
        (m.acceptedAt ||
          m.firstPaymentDate ||
          m.origin === "LEGACY_CONFIRMED_BY_ADMIN") &&
        !(
          m.state === "LEFT" &&
          m.leftAt &&
          new Date(m.leftAt) < new Date(m.season.startsAt)
        ),
    )
    .sort((a, b) => new Date(b.season.endsAt) - new Date(a.season.endsAt));
  const latest = confirmed[0];
  const season = latest?.season;
  // Stripe anchors use UTC 1st. Retention uses the agreed club season's UK calendar end.
  const seasonEnd = season
    ? DateTime.fromJSDate(new Date(season.endsAt), { zone: "UTC" })
        .minus({ days: 1 })
        .toISODate()
    : null;
  const end = seasonEnd
    ? DateTime.fromISO(seasonEnd, { zone }).endOf("day")
    : null;
  const continuing = confirmed.some(
    (m) =>
      m.state === "ACCEPTED" && !m.leftAt && new Date(m.season.endsAt) > now,
  );
  const openInvoiceCount = record._count?.invoices || 0;
  const blockers = [];
  if (!season)
    blockers.push(
      "Confirm an actual membership season first; registration dates alone are insufficient.",
    );
  if (end && now <= end.toJSDate())
    blockers.push("Keep the member until the end of their confirmed season.");
  if (continuing)
    blockers.push("A current or future accepted season membership remains.");
  if (openInvoiceCount)
    blockers.push(
      "Resolve or separately review open invoices before archiving.",
    );
  if (record.archivedAt) blockers.push("Already archived.");
  return { season, seasonEnd, end, continuing, openInvoiceCount, blockers };
}
function reviewRecord(record, now = new Date()) {
  const f = facts(record, now);
  const registered = DateTime.fromJSDate(new Date(record.createdAt), { zone });
  const inferred = registered.isValid
    ? registered.month >= 6
      ? registered.year
      : registered.year - 1
    : null;
  const state = record.archivedAt
    ? "ARCHIVED"
    : !f.season
      ? "CONFIRM_SEASON"
      : f.continuing
        ? "CURRENT_OR_RENEWED"
        : f.end && now <= f.end.toJSDate()
          ? "RETAIN_TO_SEASON_END"
          : "REVIEW_ARCHIVE";
  return {
    id: record.id,
    playerFirstName: record.playerFirstName,
    playerSurname: record.playerSurname,
    team: record.wwfcTeam || null,
    registeredAt: record.createdAt,
    confirmedSeason: f.season?.label || null,
    inferredSeason: inferred
      ? `${inferred} / ${String(inferred + 1).slice(-2)}`
      : null,
    seasonBasis: f.season ? "CONFIRMED_MEMBERSHIP" : "REGISTRATION_DATE_ONLY",
    seasonEnd: f.seasonEnd,
    state,
    renewalStatus: f.continuing
      ? "CURRENT_OR_FUTURE_MEMBERSHIP"
      : "NO_CURRENT_ACCEPTED_MEMBERSHIP",
    openInvoiceCount: f.openInvoiceCount,
    billingReviewRequired: Boolean(
      record.stripeCustomerId ||
      record.stripeScheduleId ||
      record.stripeSubscriptionId,
    ),
    archiveEligible: f.blockers.length === 0,
    archiveBlockers: f.blockers,
    archivedAt: record.archivedAt || null,
    archiveReason: record.archiveReason || null,
    archiveReviewAt: record.archiveReviewAt || null,
    archiveReviewDue: Boolean(
      record.archivedAt &&
      record.archiveReviewAt &&
      new Date(record.archiveReviewAt) <= now,
    ),
    retentionHold: Boolean(record.retentionHoldAt),
    retentionHoldReason: record.retentionHoldReason || null,
    deletionEligible: false,
  };
}
async function retentionReview(prisma, now = new Date()) {
  const records = await prisma.consentForm.findMany({
    select: selection,
    orderBy: { createdAt: "asc" },
  });
  const members = records.map((r) => reviewRecord(r, now));
  return {
    generatedAt: now.toISOString(),
    timeZone: zone,
    seasonEnd: "31 May",
    destructiveActionsEnabled: false,
    notice:
      "Confirmed season memberships drive this review. A proposed 12-month archive period is not an approved retention policy. Choose a justified review date for each archive; it is not a deletion date. Archives, holds and restore actions are supervised and logged. Permanent deletion is disabled.",
    counts: {
      total: members.length,
      archiveCandidates: members.filter((m) => m.archiveEligible).length,
      archived: members.filter((m) => m.archivedAt).length,
      reviewDue: members.filter((m) => m.archiveReviewDue).length,
      holds: members.filter((m) => m.retentionHold).length,
    },
    members,
  };
}
async function assertBillingStopped(stripe, r) {
  if (!r.stripeCustomerId) {
    if (r.stripeScheduleId || r.stripeSubscriptionId)
      throw fail("Billing references require manual review");
    return;
  }
  const customer = await stripe.customers.retrieve(r.stripeCustomerId);
  if (
    customer.deleted ||
    customer.livemode ||
    customer.metadata?.registrationId !== r.id
  )
    throw fail("Stripe customer ownership must be reviewed");
  for (const [type, list, params] of [
    ["schedule", (p) => stripe.subscriptionSchedules.list(p), {}],
    ["subscription", (p) => stripe.subscriptions.list(p), { status: "all" }],
  ]) {
    let cursor;
    let finished = false;
    for (let page = 0; page < 10; page++) {
      const result = await list({
        customer: r.stripeCustomerId,
        limit: 100,
        ...params,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      const terminal =
        type === "schedule"
          ? ["canceled", "completed", "released"]
          : ["canceled", "incomplete_expired"];
      if (result.data.some((o) => !terminal.includes(o.status)))
        throw fail("Stop all current and future Stripe plans before archiving");
      if (!result.has_more) {
        finished = true;
        break;
      }
      cursor = result.data.at(-1)?.id;
    }
    if (!finished) throw fail("Billing history requires manual review");
  }
}
async function archive(
  prisma,
  stripe,
  registrationId,
  actor,
  input,
  now = new Date(),
) {
  const r = await prisma.consentForm.findUnique({
    where: { id: registrationId },
    select: selection,
  });
  if (!r) throw fail("Member not found", 404);
  const f = facts(r, now);
  if (f.blockers.length) throw fail(f.blockers.join(" "));
  const review = DateTime.fromISO(input.reviewDate, { zone }).endOf("day");
  if (!review.isValid || review.toMillis() <= now.getTime())
    throw fail("Choose a future archive review date", 400);
  await assertBillingStopped(
    r.stripeCustomerId && typeof stripe === "function" ? stripe() : stripe,
    r,
  );
  await prisma.$transaction(
    async (tx) => {
      const current = await tx.consentForm.findUnique({
        where: { id: registrationId },
        select: selection,
      });
      if (!current) throw fail("Member not found", 404);
      const currentFacts = facts(current, now);
      if (currentFacts.blockers.length)
        throw fail(currentFacts.blockers.join(" "));
      const changed = await tx.consentForm.updateMany({
        where: { id: registrationId, archivedAt: null },
        data: {
          archivedAt: now,
          archiveSeasonId: currentFacts.season.id,
          archiveReason: input.reason,
          archiveReviewAt: review.toJSDate(),
        },
      });
      if (!changed.count) throw fail("Member changed; refresh the review");
      await tx.seasonMembership.updateMany({
        where: { registrationId },
        data: { tokenHash: null, tokenExpiresAt: null },
      });
      await tx.memberRetentionAudit.create({
        data: {
          actor,
          registrationId,
          action: "ARCHIVED",
          details: {
            seasonId: currentFacts.season.id,
            reason: input.reason,
            reviewDate: input.reviewDate,
            billingVerifiedAt: now.toISOString(),
          },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
async function restore(prisma, registrationId, actor, reason) {
  await prisma.$transaction(
    async (tx) => {
      const changed = await tx.consentForm.updateMany({
        where: { id: registrationId, archivedAt: { not: null } },
        data: {
          archivedAt: null,
          archiveSeasonId: null,
          archiveReason: null,
          archiveReviewAt: null,
        },
      });
      if (!changed.count) throw fail("Archived member not found", 404);
      await tx.memberRetentionAudit.create({
        data: {
          actor,
          registrationId,
          action: "RESTORED",
          details: { reason },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
async function hold(prisma, registrationId, actor, enabled, reason) {
  await prisma.$transaction(
    async (tx) => {
      const changed = await tx.consentForm.updateMany({
        where: { id: registrationId },
        data: {
          retentionHoldAt: enabled ? new Date() : null,
          retentionHoldReason: enabled ? reason : null,
        },
      });
      if (!changed.count) throw fail("Member not found", 404);
      await tx.memberRetentionAudit.create({
        data: {
          actor,
          registrationId,
          action: enabled ? "HOLD_SET" : "HOLD_RELEASED",
          details: { reason },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
async function review(prisma, registrationId, actor, input, now = new Date()) {
  const review = DateTime.fromISO(input.reviewDate, { zone }).endOf("day");
  if (!review.isValid || review.toMillis() <= now.getTime())
    throw fail("Choose a future review date", 400);
  await prisma.$transaction(
    async (tx) => {
      const changed = await tx.consentForm.updateMany({
        where: { id: registrationId, archivedAt: { not: null } },
        data: { archiveReviewAt: review.toJSDate() },
      });
      if (!changed.count) throw fail("Archived member not found", 404);
      await tx.memberRetentionAudit.create({
        data: {
          actor,
          registrationId,
          action: "ARCHIVE_REVIEWED",
          details: { reason: input.reason, nextReviewDate: input.reviewDate },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
module.exports = {
  review,
  selection,
  facts,
  reviewRecord,
  retentionReview,
  assertBillingStopped,
  archive,
  restore,
  hold,
};
