const Stripe = require("stripe");
const prisma = require("../prisma");

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key || !key.startsWith("sk_test_")) {
    throw new Error("A Stripe test secret key is required for this pilot");
  }

  return new Stripe(key);
}

function setupConflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

async function createRegistrationCheckout(registration) {
  // Read fresh references so a retry cannot restart existing/cancelled billing.
  registration = await prisma.consentForm.findUnique({ where: { id: registration.id } });
  if (!registration) {
    const error = new Error("Registration not found");
    error.statusCode = 404;
    throw error;
  }
  if (registration.stripeScheduleId || registration.stripeSubscriptionId || registration.stripeSubscriptionStatus) {
    throw setupConflict("This member already has billing records. Refresh their subscription status.");
  }
  const stripe = getStripe();
  const objectId = (value) => typeof value === "string" ? value : value?.id;
  let previousSession = null;
  if (registration.stripeCheckoutSessionId) {
    previousSession = await stripe.checkout.sessions.retrieve(registration.stripeCheckoutSessionId);
    if (previousSession.livemode || previousSession.mode !== "setup" ||
        previousSession.metadata?.registrationId !== registration.id ||
        objectId(previousSession.customer) !== registration.stripeCustomerId) {
      throw setupConflict("Checkout does not match this registration");
    }
    if (previousSession.status === "complete") {
      throw setupConflict("Card setup is already complete. Refresh the member; if they remain awaiting setup, check or retry the Stripe webhook.");
    }
  }

  const plans = {
    MATCHES_AND_TRAINING: {
      priceId: process.env.STRIPE_PRICE_MATCHES_TRAINING,
      amount: 2100,
      label: "Matches & Training",
    },
    TRAINING_ONLY: {
      priceId: process.env.STRIPE_PRICE_TRAINING_ONLY,
      amount: 1100,
      label: "Training only",
    },
  };

  const plan = plans[registration.paymentPlan];

  if (!plan?.priceId) {
    throw new Error("Stripe price is not configured for this plan");
  }

  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");

  if (!frontendUrl || !registration.firstPaymentDate) {
    throw new Error("Frontend URL or first payment date is missing");
  }

  // Verify the configured Stripe price matches the selected club plan.
  const price = await stripe.prices.retrieve(plan.priceId);

  if (
    price.livemode ||
    !price.active ||
    price.currency !== "gbp" ||
    price.unit_amount !== plan.amount ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1
  ) {
    throw new Error("Stripe price must match the monthly GBP test plan");
  }

  const paymentStart = new Date(registration.firstPaymentDate).getTime();
  if (!Number.isFinite(paymentStart)) throw setupConflict("First payment date is invalid");
  let customerId = registration.stripeCustomerId;
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || customer.livemode || customer.metadata?.registrationId !== registration.id) {
      throw setupConflict("Stripe customer does not match this registration");
    }
    let billingNow = Date.now();
    const clockId = objectId(customer.test_clock);
    if (clockId) {
      const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
      if (clock.status !== "ready") throw setupConflict("Stripe test clock must be ready");
      billingNow = clock.frozen_time * 1000;
    }
    if (paymentStart <= billingNow) {
      throw setupConflict("The original first payment date has passed on this customer's clock. Manual billing review is required; changing the configured clock does not move an existing customer.");
    }
  } else if (paymentStart <= Date.now()) {
    throw setupConflict("The original first payment date has passed. Manual billing review is required.");
  }
  if (previousSession?.status === "open" && previousSession.url) {
    return previousSession.url;
  }
  if (previousSession && previousSession.status !== "expired") {
    throw setupConflict("Checkout is not ready to resume. Refresh and try again.");
  }

  if (!customerId) {
    const testClockId = process.env.STRIPE_TEST_CLOCK_ID?.trim();

if (testClockId) {
  const clock = await stripe.testHelpers.testClocks.retrieve(testClockId);

  if (clock.status !== "ready") {
    throw new Error("Stripe test clock must be ready");
  }

  // The registration date is still calculated using real time.
  // Keep the clock in the same month for this test.
  const londonMonth = (seconds) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(seconds * 1000));

  if (
    londonMonth(clock.frozen_time) !==
    londonMonth(Math.floor(Date.now() / 1000))
  ) {
    throw new Error(
      "Test clock must be in the current registration month"
    );
  }
}
 const customer = await stripe.customers.create(
  {
    metadata: { registrationId: registration.id },
    ...(testClockId ? { test_clock: testClockId } : {}),
  },
  {
    idempotencyKey: `registration-customer-${registration.id}`,
  }
);

    customerId = customer.id;

    await prisma.consentForm.update({
      where: { id: registration.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const firstPaymentDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(registration.firstPaymentDate));

  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      currency: "gbp",
      customer: customerId,
    
      client_reference_id: registration.id,
      metadata: {
        registrationId: registration.id,
      },
      setup_intent_data: {
        metadata: {
          registrationId: registration.id,
        },
      },
      custom_text: {
        submit: {
          message:
            `${plan.label}: £${plan.amount / 100} per month. ` +
            `By completing setup, you authorise recurring card payments ` +
            `starting on ${firstPaymentDate}, then on the 1st of each month. ` +
            `No payment is collected today.`,
        },
      },
      success_url: `${frontendUrl}/?paymentSetup=returned`,
      cancel_url: `${frontendUrl}/?paymentSetup=cancelled`,
    },
    {
      // Concurrent retries for the same expired session create the same replacement.
      idempotencyKey: previousSession
        ? `registration-checkout-${registration.id}-after-${previousSession.id}`
        : `registration-checkout-${registration.id}`,
    }
  );

  const saved = await prisma.consentForm.updateMany({
    where: {
      id: registration.id,
      stripeCheckoutSessionId: registration.stripeCheckoutSessionId,
      stripeScheduleId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
    },
    data: { stripeCheckoutSessionId: session.id },
  });
  if (!saved.count) throw setupConflict("Billing details changed. Refresh the member before resuming setup.");
  if (session.status !== "open" || !session.url) {
    throw setupConflict("Checkout is no longer open. Refresh the member and retry setup if required.");
  }
  return session.url;
}

module.exports = {
  getStripe,
  createRegistrationCheckout,
};