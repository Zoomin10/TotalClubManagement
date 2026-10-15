const { DateTime } = require("luxon");
const crypto = require("node:crypto");
const prisma = require("../prisma");
const { getStripe } = require("./stripeService");
const id = (v) => (typeof v === "string" ? v : v?.id);
const fail = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const include = { season: { include: { plans: true } }, registration: true };
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
function dates(year) {
  return {
    startsAt: DateTime.utc(year, 6, 1).toJSDate(),
    endsAt: DateTime.utc(year + 1, 6, 1).toJSDate(),
  };
}
function nextPayment(now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: "Europe/London" }).plus({
    months: 1,
  });
  return DateTime.utc(local.year, local.month, 1).toJSDate();
}
function publicSeason(season) {
  return {
    id: season.id,
    label: season.label,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    termsVersion: season.termsVersion,
    termsContent: season.termsContent,
    plans: season.plans.map((p) => ({
      paymentPlan: p.paymentPlan,
      amountPence: p.amountPence,
    })),
  };
}
async function newOffer(now = new Date()) {
  if (process.env.SEASON_MEMBERSHIP_ENABLED !== "true") return null;
  const start = nextPayment(now);
  const season = await prisma.clubSeason.findFirst({
    where: {
      status: "PUBLISHED",
      startsAt: { lte: start },
      endsAt: { gt: start },
    },
    include: { plans: true },
  });
  if (!season)
    throw fail(
      "The club has not published plans covering your first payment date.",
      503,
    );
  return { ...publicSeason(season), firstPaymentDate: start };
}
async function checkPrice(stripe, priceId, amount) {
  const price = await stripe.prices.retrieve(priceId);
  if (
    price.livemode ||
    !price.active ||
    price.currency !== "gbp" ||
    price.unit_amount !== amount ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1
  )
    throw fail(
      "Each Stripe test price must match the configured monthly GBP amount.",
    );
  return price;
}
async function billingNow(stripe, customer) {
  if (customer.deleted || customer.livemode)
    throw fail("Stripe test customer is unavailable");
  if (customer.test_clock) {
    const clock = await stripe.testHelpers.testClocks.retrieve(
      id(customer.test_clock),
    );
    if (clock.status !== "ready") throw fail("Stripe test clock must be ready");
    return clock.frozen_time * 1000;
  }
  return Date.now();
}
function own(object, registration) {
  if (
    object.livemode ||
    id(object.customer) !== registration.stripeCustomerId ||
    object.metadata?.registrationId !== registration.id
  )
    throw fail("Stripe object does not belong to this member");
}
async function allItems(list, params) {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await list({
      ...params,
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    out.push(...result.data);
    if (!result.has_more) return out;
    cursor = result.data.at(-1)?.id;
  }
  throw fail("Too many billing records; manual review required");
}
async function noOverlap(stripe, registration, start, membership) {
  if (!registration.stripeCustomerId) return;
  const schedules = await allItems(
    (p) => stripe.subscriptionSchedules.list(p),
    { customer: registration.stripeCustomerId },
  );
  const bounded = new Set();
  for (const schedule of schedules) {
    if (
      ["canceled", "completed", "released"].includes(schedule.status) ||
      schedule.id === membership?.stripeScheduleId
    )
      continue;
    const end =
      Math.max(...schedule.phases.map((p) => p.end_date || Infinity)) * 1000;
    if (schedule.end_behavior !== "cancel" || end > start.getTime())
      throw fail(
        "Another schedule could collect in the new season. End the previous plan first.",
      );
    if (schedule.subscription) bounded.add(id(schedule.subscription));
  }
  const subs = await allItems((p) => stripe.subscriptions.list(p), {
    customer: registration.stripeCustomerId,
    status: "all",
  });
  for (const sub of subs) {
    if (
      ["canceled", "incomplete_expired"].includes(sub.status) ||
      sub.id === membership?.stripeSubscriptionId ||
      bounded.has(sub.id)
    )
      continue;
    if (!sub.cancel_at || sub.cancel_at * 1000 > start.getTime())
      throw fail(
        "An existing subscription could overlap the new season. Confirm its season-end first.",
      );
  }
}
async function customerFor(stripe, registration) {
  if (registration.stripeCustomerId) {
    const c = await stripe.customers.retrieve(registration.stripeCustomerId);
    if (
      c.deleted ||
      c.livemode ||
      c.metadata?.registrationId !== registration.id
    )
      throw fail("Customer ownership mismatch");
    return c;
  }
  const clock = process.env.STRIPE_TEST_CLOCK_ID?.trim();
  if (clock) {
    const c = await stripe.testHelpers.testClocks.retrieve(clock);
    if (c.status !== "ready") throw fail("Test clock must be ready");
  }
  const c = await stripe.customers.create(
    {
      metadata: { registrationId: registration.id },
      ...(clock ? { test_clock: clock } : {}),
    },
    { idempotencyKey: `registration-customer-${registration.id}` },
  );
  await prisma.consentForm.update({
    where: { id: registration.id },
    data: { stripeCustomerId: c.id },
  });
  registration.stripeCustomerId = c.id;
  return c;
}
async function checkout(membershipId) {
  const m = await prisma.seasonMembership.findUnique({
    where: { id: membershipId },
    include,
  });
  if (!m || m.registration.archivedAt || m.state !== "ACCEPTED" || m.leftAt)
    throw fail("This season membership is not ready for payment setup");
  if (m.stripeScheduleId || m.stripeSubscriptionId) return null;
  const stripe = getStripe();
  await checkPrice(stripe, m.stripePriceId, m.amountPence);
  const customer = await customerFor(stripe, m.registration);
  const now = await billingNow(stripe, customer);
  if (
    !m.firstPaymentDate ||
    m.firstPaymentDate.getTime() <= now ||
    m.firstPaymentDate >= m.season.endsAt
  )
    throw fail(
      "Payment start has passed or falls outside this season. Contact the club; no immediate charge has been made.",
    );
  await noOverlap(stripe, m.registration, m.firstPaymentDate, m);
  let prior;
  if (m.stripeCheckoutSessionId) {
    prior = await stripe.checkout.sessions.retrieve(m.stripeCheckoutSessionId);
    own(prior, m.registration);
    if (prior.metadata?.seasonMembershipId !== m.id)
      throw fail("Checkout mismatch");
    if (prior.status === "open") return prior.url;
    if (prior.status === "complete")
      throw fail(
        "Card setup completed. Wait for the webhook or ask the club to retry it.",
      );
  }
  const root = process.env.FRONTEND_URL?.replace(/\/$/, "");
  if (!root) throw fail("Public app URL is missing", 503);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      currency: "gbp",
      customer: customer.id,
      client_reference_id: m.registrationId,
      metadata: { registrationId: m.registrationId, seasonMembershipId: m.id },
      setup_intent_data: {
        metadata: {
          registrationId: m.registrationId,
          seasonMembershipId: m.id,
        },
      },
      custom_text: {
        submit: {
          message: `${m.season.label}: £${(m.amountPence / 100).toFixed(2)} monthly from ${m.firstPaymentDate.toISOString().slice(0, 10)}. Final scheduled collection is 1 May ${m.season.startYear + 1}. No charge today. Future payments stop if you leave; existing arrears remain separate.`,
        },
      },
      success_url: `${root}/?paymentSetup=returned`,
      cancel_url: `${root}/?paymentSetup=cancelled`,
    },
    { idempotencyKey: `season-checkout-${m.id}-${prior?.id || "initial"}` },
  );
  const saved = await prisma.seasonMembership.updateMany({
    where: {
      id: m.id,
      state: "ACCEPTED",
      leftAt: null,
      stripeScheduleId: null,
      stripeCheckoutSessionId: m.stripeCheckoutSessionId,
    },
    data: { stripeCheckoutSessionId: session.id },
  });
  if (!saved.count) throw fail("Membership changed; refresh before continuing");
  return session.url;
}
async function showInitialSchedule(m, schedule) {
  // Future renewals stay separate until their subscription starts. Only the
  // initial signup's own first-payment date may update the directory here.
  await prisma.consentForm.updateMany({
    where: {
      id: m.registrationId,
      firstPaymentDate: m.firstPaymentDate,
      stripeSubscriptionId: null,
      OR: [
        { stripeSubscriptionStatus: null },
        { stripeSubscriptionStatus: { not: "canceled" } },
      ],
    },
    data: {
      stripeScheduleId: schedule.id,
      stripeCheckoutSessionId: m.stripeCheckoutSessionId,
      stripeSubscriptionStatus: ["canceled", "completed"].includes(
        schedule.status,
      )
        ? "canceled"
        : "scheduled",
    },
  });
}
async function completeSetup(stripe, session) {
  if (!session.metadata?.seasonMembershipId) return false;
  if (session.mode !== "setup" || session.status !== "complete") return true;
  const m = await prisma.seasonMembership.findUnique({
    where: { id: session.metadata.seasonMembershipId },
    include,
  });
  if (
    !m ||
    m.registrationId !== session.metadata.registrationId ||
    m.stripeCheckoutSessionId !== session.id
  )
    throw fail("Season checkout mismatch");
  own(session, m.registration);
  if (m.registration.archivedAt || m.state !== "ACCEPTED" || m.leftAt) return true;
  if (m.stripeScheduleId) {
    const schedule = await stripe.subscriptionSchedules.retrieve(
      m.stripeScheduleId,
    );
    own(schedule, m.registration);
    await prisma.seasonMembership.update({
      where: { id: m.id },
      data: {
        tokenHash: null,
        tokenExpiresAt: null,
        billingStatus: ["canceled", "completed"].includes(schedule.status)
          ? "canceled"
          : m.stripeSubscriptionId
            ? m.billingStatus
            : "scheduled",
      },
    });
    await showInitialSchedule(m, schedule);
    return true;
  }
  const setup = await stripe.setupIntents.retrieve(id(session.setup_intent));
  if (
    setup.status !== "succeeded" ||
    id(setup.customer) !== m.registration.stripeCustomerId ||
    !setup.payment_method
  )
    throw fail("Payment method setup incomplete");
  // Recover a successful Stripe create followed by a failed DB write, including after
  // Stripe's idempotency retention expires. Never create a second schedule.
  const prior = (
    await allItems((p) => stripe.subscriptionSchedules.list(p), {
      customer: m.registration.stripeCustomerId,
    })
  ).filter((s) => s.metadata?.seasonMembershipId === m.id);
  if (prior.length > 1)
    throw fail("Duplicate seasonal schedules require manual review");
  if (prior.length) {
    const schedule = prior[0];
    own(schedule, m.registration);
    const saved = await prisma.seasonMembership.updateMany({
      where: { id: m.id, state: "ACCEPTED", leftAt: null },
      data: {
        stripeScheduleId: schedule.id,
        billingStatus: ["canceled", "completed"].includes(schedule.status)
          ? "canceled"
          : "scheduled",
        tokenHash: null,
        tokenExpiresAt: null,
      },
    });
    if (!saved.count)
      await stopRefs(
        stripe,
        m.registration,
        schedule.id,
        id(schedule.subscription),
      );
    if (saved.count) await showInitialSchedule(m, schedule);
    return true;
  }
  await checkPrice(stripe, m.stripePriceId, m.amountPence);
  const customer = await stripe.customers.retrieve(
    m.registration.stripeCustomerId,
  );
  const now = await billingNow(stripe, customer);
  if (
    m.firstPaymentDate.getTime() <= now ||
    m.firstPaymentDate >= m.season.endsAt
  )
    throw fail("Season start passed; manual review required");
  await noOverlap(stripe, m.registration, m.firstPaymentDate, m);
  const metadata = {
    registrationId: m.registrationId,
    seasonMembershipId: m.id,
    seasonId: m.seasonId,
  };
  const schedule = await stripe.subscriptionSchedules.create(
    {
      customer: m.registration.stripeCustomerId,
      start_date: Math.floor(m.firstPaymentDate.getTime() / 1000),
      end_behavior: "cancel",
      metadata,
      default_settings: {
        collection_method: "charge_automatically",
        default_payment_method: id(setup.payment_method),
      },
      phases: [
        {
          items: [{ price: m.stripePriceId, quantity: 1 }],
          end_date: Math.floor(m.season.endsAt.getTime() / 1000),
          metadata,
          proration_behavior: "none",
        },
      ],
    },
    { idempotencyKey: `season-schedule-${m.id}` },
  );
  // Also reconciled by schedule webhooks if a concurrent leave races creation.
  const saved = await prisma.seasonMembership.updateMany({
    where: { id: m.id, state: "ACCEPTED", leftAt: null },
    data: {
      stripeScheduleId: schedule.id,
      billingStatus: "scheduled",
      tokenHash: null,
      tokenExpiresAt: null,
    },
  });
  if (!saved.count) {
    await stripe.subscriptionSchedules.cancel(schedule.id, {
      invoice_now: false,
      prorate: false,
    });
    throw fail("Membership changed during setup; schedule cancelled");
  }
  await showInitialSchedule(m, schedule);
  return true;
}
async function syncSubscription(stripe, subscription) {
  const known = subscription.metadata?.seasonMembershipId
    ? null
    : await prisma.seasonMembership.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });
  const membershipId = subscription.metadata?.seasonMembershipId || known?.id;
  if (!membershipId) return false;
  const m = await prisma.seasonMembership.findUnique({
    where: { id: membershipId },
    include,
  });
  if (!m) throw fail("Season membership not found");
  own(subscription, m.registration);
  if (m.stripeSubscriptionId && m.stripeSubscriptionId !== subscription.id)
    throw fail("Season subscription mismatch");
  if (
    (!m.stripeScheduleId || id(subscription.schedule) !== m.stripeScheduleId) &&
    m.stripeSubscriptionId !== subscription.id
  )
    throw fail("Season schedule mismatch");
  if (
    m.leftAt &&
    !["canceled", "incomplete_expired"].includes(subscription.status)
  ) {
    await stopRefs(stripe, m.registration, m.stripeScheduleId, subscription.id);
    return true;
  }
  await prisma.seasonMembership.update({
    where: { id: m.id },
    data: {
      stripeSubscriptionId: subscription.id,
      billingStatus: subscription.status,
    },
  });
  const customer = await stripe.customers.retrieve(
    m.registration.stripeCustomerId,
  );
  const now = await billingNow(stripe, customer);
  if (
    m.firstPaymentDate &&
    m.firstPaymentDate.getTime() <= now &&
    (!m.registration.firstPaymentDate ||
      m.registration.firstPaymentDate <= m.firstPaymentDate)
  )
    await prisma.consentForm.update({
      where: { id: m.registrationId },
      data: {
        stripeSubscriptionId: subscription.id,
        stripeScheduleId: m.stripeScheduleId,
        stripeCheckoutSessionId: m.stripeCheckoutSessionId,
        stripeSubscriptionStatus: subscription.status,
        paymentPlan: m.paymentPlan,
        monthlyAmountPence: m.amountPence,
        firstPaymentDate: m.firstPaymentDate,
      },
    });
  return true;
}
async function stopRefs(stripe, registration, scheduleId, subscriptionId) {
  if (scheduleId) {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    own(schedule, registration);
    subscriptionId =
      subscriptionId ||
      id(schedule.subscription) ||
      id(schedule.released_subscription);
    if (["not_started", "active"].includes(schedule.status))
      await stripe.subscriptionSchedules.cancel(schedule.id, {
        invoice_now: false,
        prorate: false,
      });
  }
  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    own(sub, registration);
    if (!["canceled", "incomplete_expired"].includes(sub.status))
      await stripe.subscriptions.cancel(sub.id, {
        invoice_now: false,
        prorate: false,
      });
  }
}
async function stopSeason(m, stripe) {
  await stopRefs(
    stripe,
    m.registration,
    m.stripeScheduleId,
    m.stripeSubscriptionId,
  );
  await prisma.seasonMembership.update({
    where: { id: m.id },
    data: { billingStatus: "canceled" },
  });
}
async function leaveAll(registrationId, actor) {
  const registration = await prisma.consentForm.findUnique({
    where: { id: registrationId },
  });
  if (!registration) throw fail("Member not found", 404);
  if(registration.archivedAt)throw fail("Restore and review this archived record before membership actions",403);
  const items = await prisma.$transaction(async (tx) => {
    const rows = await tx.seasonMembership.findMany({
      where: { registrationId },
      include,
    });
    await tx.seasonMembership.updateMany({
      where: { registrationId },
      data: {
        state: "LEFT",
        leftAt: new Date(),
        tokenHash: null,
        tokenExpiresAt: null,
      },
    });
    await tx.seasonChange.create({
      data: {
        actor,
        action: "LEAVING_REQUESTED",
        registrationId,
        details: { memberships: rows.map((r) => r.id) },
      },
    });
    return rows;
  });
  const stripe = getStripe();
  for (const m of items) await stopSeason(m, stripe);
  await stopRefs(
    stripe,
    registration,
    registration.stripeScheduleId,
    registration.stripeSubscriptionId,
  );
  // An unfinished legacy Checkout must not be able to create billing after departure.
  if (registration.stripeCheckoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      registration.stripeCheckoutSessionId,
    );
    own(session, registration);
    if (session.status === "open")
      await stripe.checkout.sessions.expire(session.id);
  }
  await prisma.consentForm.update({
    where: { id: registrationId },
    data: { stripeSubscriptionStatus: "canceled" },
  });
  await prisma.seasonChange.create({
    data: {
      actor,
      action: "LEAVING_BILLING_CANCELLED",
      registrationId,
      details: { memberships: items.length },
    },
  });
  return items.length;
}
async function syncSchedule(stripe, eventSchedule) {
  const schedule = await stripe.subscriptionSchedules.retrieve(
    eventSchedule.id,
  );
  const membershipId = schedule.metadata?.seasonMembershipId;
  if (!membershipId) return;
  const m = await prisma.seasonMembership.findUnique({
    where: { id: membershipId },
    include,
  });
  if (!m) throw fail("Schedule membership missing");
  own(schedule, m.registration);
  if (m.stripeScheduleId && m.stripeScheduleId !== schedule.id)
    throw fail("Schedule mismatch");
  if (m.leftAt || m.state === "LEFT") {
    await stopRefs(
      stripe,
      m.registration,
      schedule.id,
      id(schedule.subscription),
    );
    return;
  }
  await prisma.seasonMembership.update({
    where: { id: m.id },
    data: {
      stripeScheduleId: schedule.id,
      ...(schedule.subscription
        ? { stripeSubscriptionId: id(schedule.subscription) }
        : {}),
      ...(["canceled", "completed"].includes(schedule.status)
        ? { billingStatus: "canceled" }
        : {}),
    },
  });
}
async function endLegacy(registration, season, actor) {
  const existing = await prisma.seasonMembership.findUnique({
    where: {
      registrationId_seasonId: {
        registrationId: registration.id,
        seasonId: season.id,
      },
    },
  });
  if (existing)
    throw fail(
      "This member already has a record for that season; review it rather than converting again",
    );
  const stripe = getStripe();
  if (!registration.stripeCustomerId)
    throw fail(
      "No Stripe customer; use new signup or seasonal renewal instead",
    );
  const customer = await stripe.customers.retrieve(
    registration.stripeCustomerId,
  );
  const now = await billingNow(stripe, customer);
  if (season.endsAt.getTime() <= now)
    throw fail("Season end has already passed");
  let sub = registration.stripeSubscriptionId
    ? await stripe.subscriptions.retrieve(registration.stripeSubscriptionId)
    : null;
  if (sub) {
    own(sub, registration);
    if (
      sub.cancel_at &&
      sub.cancel_at * 1000 < season.endsAt.getTime() &&
      !["canceled", "incomplete_expired"].includes(sub.status)
    )
      throw fail(
        "This plan already has an earlier cancellation date. Manual review is required; it will not be extended.",
      );
  }
  if (registration.stripeScheduleId) {
    const schedule = await stripe.subscriptionSchedules.retrieve(
      registration.stripeScheduleId,
    );
    own(schedule, registration);
    const linked =
      id(schedule.subscription) || id(schedule.released_subscription);
    if (sub && linked && sub.id !== linked)
      throw fail(
        "Legacy schedule and subscription disagree; manual review required",
      );
    if (["active", "not_started"].includes(schedule.status)) {
      if (schedule.phases.length !== 1)
        throw fail("Multiple schedule phases require manual Stripe review");
      const phase = schedule.phases[0];
      if (
        schedule.end_behavior === "cancel" &&
        phase.end_date * 1000 < season.endsAt.getTime()
      )
        throw fail(
          "The schedule already ends earlier. Manual review is required; it will not be extended.",
        );
      if (
        phase.start_date >= Math.floor(season.endsAt.getTime() / 1000) ||
        !phase.items?.length ||
        phase.items.length !== 1 ||
        (phase.items[0].quantity || 1) !== 1
      )
        throw fail("Complex schedule requires manual review");
      const anchor = DateTime.fromSeconds(phase.start_date, { zone: "UTC" });
      if (anchor.day !== 1 || anchor.hour !== 0 || anchor.minute !== 0)
        throw fail(
          "Legacy billing anchor needs manual review before season conversion",
        );
      await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: "cancel",
          proration_behavior: "none",
          phases: [
            {
              start_date: phase.start_date,
              end_date: Math.floor(season.endsAt.getTime() / 1000),
              items: [{ price: id(phase.items[0].price), quantity: 1 }],
              metadata: phase.metadata || { registrationId: registration.id },
              proration_behavior: "none",
            },
          ],
        },
        { idempotencyKey: `season-end-${registration.id}-${season.id}` },
      );
      sub = schedule.subscription
        ? await stripe.subscriptions.retrieve(id(schedule.subscription))
        : sub;
    } else if (schedule.released_subscription && !sub)
      sub = await stripe.subscriptions.retrieve(
        id(schedule.released_subscription),
      );
  }
  if (sub) {
    own(sub, registration);
    if (
      !["canceled", "incomplete_expired"].includes(sub.status) &&
      !sub.schedule
    ) {
      const anchor = DateTime.fromSeconds(sub.billing_cycle_anchor, {
        zone: "UTC",
      });
      if (anchor.day !== 1 || anchor.hour !== 0 || anchor.minute !== 0)
        throw fail("Legacy billing anchor requires manual review");
      await stripe.subscriptions.update(
        sub.id,
        {
          cancel_at: Math.floor(season.endsAt.getTime() / 1000),
          proration_behavior: "none",
        },
        { idempotencyKey: `season-end-sub-${registration.id}-${season.id}` },
      );
    }
  }
  if (!sub && !registration.stripeScheduleId)
    throw fail("No existing Stripe plan to end");
  await prisma.seasonMembership.upsert({
    where: {
      registrationId_seasonId: {
        registrationId: registration.id,
        seasonId: season.id,
      },
    },
    create: {
      registrationId: registration.id,
      seasonId: season.id,
      state: "ACCEPTED",
      origin: "LEGACY_CONFIRMED_BY_ADMIN",
      paymentPlan: registration.paymentPlan,
      amountPence: registration.monthlyAmountPence,
      firstPaymentDate: registration.firstPaymentDate,
      stripeScheduleId: registration.stripeScheduleId,
      stripeSubscriptionId: sub?.id || registration.stripeSubscriptionId,
      billingStatus: sub?.status || registration.stripeSubscriptionStatus,
    },
    update: {},
  });
  await prisma.seasonChange.create({
    data: {
      actor,
      action: "LEGACY_SEASON_END_SET",
      seasonId: season.id,
      registrationId: registration.id,
      details: { endsAt: season.endsAt.toISOString() },
    },
  });
  return { endsAt: season.endsAt };
}
module.exports = {
  dates,
  nextPayment,
  publicSeason,
  newOffer,
  checkPrice,
  checkout,
  completeSetup,
  syncSubscription,
  noOverlap,
  leaveAll,
  endLegacy,
  syncSchedule,
  hash,
  fail,
  include,
};
