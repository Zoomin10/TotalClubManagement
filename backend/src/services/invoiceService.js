const prisma = require("../prisma");

function objectId(value) {
  return typeof value === "string" ? value : value?.id;
}

function stripeDate(seconds) {
  return seconds == null ? null : new Date(seconds * 1000);
}

async function syncMembershipInvoice(stripe, invoiceId, event = null) {
  // Retry transaction conflicts caused by simultaneous webhook deliveries.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.membershipInvoice.findUnique({
            where: { stripeInvoiceId: invoiceId },
          });

          // Retrieve current state instead of saving an old event snapshot.
          const invoice = await stripe.invoices.retrieve(invoiceId);

          if (invoice.livemode) {
            throw new Error("Live invoices are disabled for this pilot");
          }

          const subscriptionId = objectId(
            invoice.parent?.subscription_details?.subscription ||
              invoice.subscription
          );

          // Ignore invoices unrelated to subscriptions.
          if (!subscriptionId) return null;

          const subscription = await stripe.subscriptions.retrieve(
            subscriptionId
          );

          const registrationId = subscription.metadata?.registrationId;

          // Ignore subscriptions not created by this app.
          if (!registrationId) return null;

          const registration = await tx.consentForm.findUnique({
            where: { id: registrationId },
          });

          if (!registration) {
            throw new Error("Invoice registration was not found");
          }

          if (
            registration.stripeCustomerId !== objectId(invoice.customer) ||
            registration.stripeCustomerId !==
              objectId(subscription.customer) ||
            (registration.stripeSubscriptionId &&
              registration.stripeSubscriptionId !== subscriptionId)
          ) {
            throw new Error("Invoice does not match the registration");
          }

          if (
            existing &&
            existing.registrationId !== registrationId
          ) {
            throw new Error("Invoice is already linked to another registration");
          }

          let lastPaymentFailedAt =
            existing?.lastPaymentFailedAt ?? null;

          if (event?.type === "invoice.payment_failed") {
            const failedAt = stripeDate(event.created);

            if (
              !lastPaymentFailedAt ||
              failedAt > lastPaymentFailedAt
            ) {
              lastPaymentFailedAt = failedAt;
            }
          }

          const data = {
            registrationId,
            stripeSubscriptionId: subscriptionId,
            invoiceNumber: invoice.number ?? null,
            currency: invoice.currency,
            amountDuePence: invoice.amount_due,
            amountPaidPence: invoice.amount_paid,
            amountRemainingPence: invoice.amount_remaining,
            status: invoice.status,
            attemptCount: invoice.attempt_count ?? 0,
            lastPaymentFailedAt,
            nextPaymentAttemptAt: stripeDate(invoice.next_payment_attempt),
            invoiceCreatedAt: stripeDate(invoice.created),
            paidAt: stripeDate(invoice.status_transitions?.paid_at),
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            invoicePdfUrl: invoice.invoice_pdf ?? null,
          };

          return tx.membershipInvoice.upsert({
            where: { stripeInvoiceId: invoice.id },
            create: {
              stripeInvoiceId: invoice.id,
              ...data,
            },
            update: data,
          });
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
          timeout: 20000,
        }
      );
    } catch (error) {
      if (error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}

module.exports = { syncMembershipInvoice };