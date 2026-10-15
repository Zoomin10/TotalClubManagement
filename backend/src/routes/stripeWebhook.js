const express = require("express");
const { DateTime } = require("luxon");
const prisma = require("../prisma");
const { getStripe } = require("../services/stripeService");
const { syncMembershipInvoice } = require("../services/invoiceService");
const seasons = require("../services/seasons");
const router = express.Router();

function objectId(value) {
  return typeof value === "string" ? value : value?.id;
}

async function completeSetup(stripe, session) {
  if (await seasons.completeSetup(stripe, session)) return;
  if (session.mode !== "setup" || session.status !== "complete") {
    return;
  }

  const registrationId = session.metadata?.registrationId;
  if (!registrationId) return;

  const registration = await prisma.consentForm.findUnique({
    where: { id: registrationId },
  });

  if (!registration) {
    throw new Error("Checkout registration was not found");
  }

  if (
    registration.stripeCustomerId !== objectId(session.customer) ||
    registration.stripeCheckoutSessionId !== session.id
  ) {
    throw new Error("Checkout does not match the registration");
  }

  if (registration.archivedAt || registration.stripeSubscriptionStatus === "canceled") return;
  // A completed setup must never create another schedule.
  if (registration.stripeScheduleId) return;

  const setupIntent = await stripe.setupIntents.retrieve(
    objectId(session.setup_intent),
  );

  if (
    setupIntent.status !== "succeeded" ||
    objectId(setupIntent.customer) !== registration.stripeCustomerId ||
    !setupIntent.payment_method
  ) {
    throw new Error("Payment method setup is not complete");
  }

  const plans = {
    MATCHES_AND_TRAINING: {
      priceId: process.env.STRIPE_PRICE_MATCHES_TRAINING,
      amount: 2100,
    },
    TRAINING_ONLY: {
      priceId: process.env.STRIPE_PRICE_TRAINING_ONLY,
      amount: 1100,
    },
  };

  const plan = plans[registration.paymentPlan];

  if (!plan?.priceId || !registration.firstPaymentDate) {
    throw new Error("Registration billing details are missing");
  }

  const price = await stripe.prices.retrieve(plan.priceId);

  if (
    price.livemode ||
    !price.active ||
    price.currency !== "gbp" ||
    price.unit_amount !== plan.amount ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1
  ) {
    throw new Error("Stripe price does not match the club plan");
  }

  const start = DateTime.fromJSDate(registration.firstPaymentDate, {
    zone: "Europe/London",
  });

  const startDate = Math.floor(start.toSeconds());

  // Do not silently backdate or immediately charge a delayed setup.
  const customer = await stripe.customers.retrieve(
    registration.stripeCustomerId,
  );

  if (customer.deleted) {
    throw new Error("Stripe customer has been deleted");
  }

  let billingNow = Math.floor(Date.now() / 1000);
  const testClockId = objectId(customer.test_clock);

  if (testClockId) {
    const clock = await stripe.testHelpers.testClocks.retrieve(testClockId);

    if (clock.status !== "ready") {
      throw new Error("Stripe test clock must be ready");
    }

    billingNow = clock.frozen_time;
  }

  if (!start.isValid || startDate <= billingNow) {
    throw new Error(
      "First payment date has passed; manual billing review required",
    );
  }

  const schedule = await stripe.subscriptionSchedules.create(
    {
      customer: registration.stripeCustomerId,
      start_date: startDate,
      end_behavior: "release",
      metadata: { registrationId },
      default_settings: {
        collection_method: "charge_automatically",
        default_payment_method: objectId(setupIntent.payment_method),
      },
      phases: [
        {
          items: [{ price: plan.priceId, quantity: 1 }],
          end_date: Math.floor(start.plus({ months: 1 }).toSeconds()),
          metadata: { registrationId },
          proration_behavior: "none",
        },
      ],
    },
    {
      idempotencyKey: `registration-schedule-${registration.id}`,
    },
  );

  const current = await prisma.consentForm.findUnique({
    where: { id: registration.id },
  });
  if (current.archivedAt || current.stripeSubscriptionStatus === "canceled") {
    await stripe.subscriptionSchedules.cancel(schedule.id, {
      invoice_now: false,
      prorate: false,
    });
    return;
  }
  await prisma.consentForm.update({
    where: { id: registration.id },
    data: { stripeScheduleId: schedule.id },
  });

  // Avoid overwriting an active subscription status on a delayed retry.
  await prisma.consentForm.updateMany({
    where: {
      id: registration.id,
      stripeSubscriptionId: null,
    },
    data: { stripeSubscriptionStatus: "scheduled" },
  });
}

async function syncSubscription(stripe, eventSubscription) {
  // Read Stripe's current state rather than trusting event delivery order.
  const subscription = await stripe.subscriptions.retrieve(
    eventSubscription.id,
  );

  if (await seasons.syncSubscription(stripe, subscription)) return;
  const registrationId = subscription.metadata?.registrationId;
  if (!registrationId) return;

  const registration = await prisma.consentForm.findUnique({
    where: { id: registrationId },
  });

  if (!registration) return;

  if (
    registration.stripeCustomerId !== objectId(subscription.customer) ||
    (registration.stripeSubscriptionId &&
      registration.stripeSubscriptionId !== subscription.id)
  ) {
    throw new Error("Subscription does not match the registration");
  }

  await prisma.consentForm.update({
    where: { id: registration.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
    },
  });
}

router.post("/", async (req, res) => {
  let stripe;

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({
      error: "Stripe webhook is not configured",
    });
  }

  try {
    stripe = getStripe();
  } catch (error) {
    return res.status(500).json({
      error: "Stripe test integration is not configured",
    });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    return res.status(400).json({
      error: "Invalid Stripe webhook signature",
    });
  }

  if (event.livemode) {
    return res.status(400).json({
      error: "Live events are disabled for this pilot",
    });
  }

  try {
    switch (event.type) {
      case "subscription_schedule.created":
      case "subscription_schedule.updated":
      case "subscription_schedule.canceled":
      case "subscription_schedule.completed":
        await seasons.syncSchedule(stripe, event.data.object);
        break;
      case "checkout.session.completed":
        await completeSetup(stripe, event.data.object);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(stripe, event.data.object);
        break;
      case "invoice.finalized":
      case "invoice.updated":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.payment_action_required":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        await syncMembershipInvoice(stripe, event.data.object.id, event);
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", event.id, error.message);

    // Stripe can retry failed deliveries.
    return res.status(500).json({
      error: "Webhook processing failed",
    });
  }
});

module.exports = router;
