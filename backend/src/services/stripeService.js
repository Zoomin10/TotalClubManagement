const Stripe = require("stripe");
const prisma = require("../prisma");

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key || !key.startsWith("sk_test_")) {
    throw new Error("A Stripe test secret key is required for this pilot");
  }

  return new Stripe(key);
}

async function createRegistrationCheckout(registration) {
  const stripe = getStripe();

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

  let customerId = registration.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        metadata: { registrationId: registration.id },
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
      payment_method_types: ["card"],
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
      idempotencyKey: `registration-checkout-${registration.id}`,
    }
  );

  await prisma.consentForm.update({
    where: { id: registration.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return session.url;
}

module.exports = {
  getStripe,
  createRegistrationCheckout,
};