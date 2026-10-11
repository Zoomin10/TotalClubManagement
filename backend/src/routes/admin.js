const express = require("express");
const jwt = require("jsonwebtoken");
const { createObjectCsvStringifier } = require("csv-writer");

const prisma = require("../prisma");
const { getStripe, createRegistrationCheckout } = require("../services/stripeService");
const {
  syncMembershipInvoice,
} = require("../services/invoiceService");
const { verifyTrudashAdmin } = require("../middleware/trudashAdmin");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.get("x-trudash-assertion")) {
    if (verifyTrudashAdmin(req, res)) return next();
    return;
  }
  if (process.env.TRUDASH_ONLY_ADMIN_AUTH === "true") {
    return res.status(401).json({ error: "Sign in through TruDash" });
  }
  const token = req.cookies?.admin_token;

  if (!token) {
    return res.status(401).json({ error: "Admin login required" });
  }

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims.role !== "admin") throw new Error("Admin role required");
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired admin session" });
  }
}

router.post("/login", (req, res) => {
  if (process.env.TRUDASH_ONLY_ADMIN_AUTH === "true") {
    return res.status(403).json({ error: "Use Microsoft sign-in through TruDash" });
  }
  try {
    const { password } = req.body;

    if (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
      return res.status(500).json({ error: "Admin auth is not configured" });
    }

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const token = jwt.sign(
      { role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 8 * 60 * 60 * 1000,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Admin login failed" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  res.json({ success: true });
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

function isDevelopmentAge(ageGroup) {
  const age = Number(String(ageGroup).replace("u", ""));
  return age <= 11;
}

router.get("/dashboard", requireAdmin, async (req, res) => {
  try {
    const forms = await prisma.consentForm.findMany();

    const total = forms.length;
    const boys = forms.filter((f) => f.playerSex === "Male").length;
    const girls = forms.filter((f) => f.playerSex === "Female").length;
    const development = forms.filter((f) => isDevelopmentAge(f.ageGroup)).length;
    const competitive = forms.filter((f) => !isDevelopmentAge(f.ageGroup)).length;
    const adult = forms.filter((f) => {
      const age = Number(String(f.ageGroup).replace("u", ""));
      return age >= 18;
    }).length;

    res.json({ total, boys, girls, development, competitive, adult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

router.get("/registrations", requireAdmin, async (req, res) => {
  try {
    const { ageGroup, wwfcTeam, playerSex } = req.query;

    const registrations = await prisma.consentForm.findMany({
      where: {
        ageGroup: ageGroup || undefined,
        wwfcTeam: wwfcTeam || undefined,
        playerSex: playerSex || undefined,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(registrations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load registrations" });
  }
});

router.delete("/registrations/:id", requireAdmin, async (req, res) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL;

    if (
      !req.trudashAdmin && (
        !frontendUrl ||
        req.get("origin") !== new URL(frontendUrl).origin
      )
    ) {
      return res.status(403).json({ error: "Invalid request origin" });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({
        error: "Deletion confirmation is required",
      });
    }

    const registration = await prisma.consentForm.findUnique({
      where: { id: req.params.id },
    });

    if (!registration) {
      return res.status(404).json({ error: "Member not found" });
    }

    // getStripe() requires a test secret key for this pilot.
    const stripe = getStripe();
    const objectId = (value) =>
      typeof value === "string" ? value : value?.id;

    function verifyOwnership(object) {
      if (
        object.livemode ||
        objectId(object.customer) !== registration.stripeCustomerId ||
        object.metadata?.registrationId !== registration.id
      ) {
        const error = new Error(
          "Stripe billing does not match this member"
        );
        error.statusCode = 409;
        throw error;
      }
    }

    let schedule = null;

    if (registration.stripeScheduleId) {
      schedule = await stripe.subscriptionSchedules.retrieve(
        registration.stripeScheduleId
      );

      verifyOwnership(schedule);

      if (["not_started", "active"].includes(schedule.status)) {
        return res.status(409).json({
          error: "Cancel membership payments before deleting this member",
        });
      }
    }

    const linkedSubscriptionId =
      objectId(schedule?.subscription) ||
      objectId(schedule?.released_subscription);

    if (
      linkedSubscriptionId &&
      registration.stripeSubscriptionId &&
      linkedSubscriptionId !== registration.stripeSubscriptionId
    ) {
      return res.status(409).json({
        error: "Stripe schedule and subscription do not match",
      });
    }

    const subscriptionId =
      registration.stripeSubscriptionId || linkedSubscriptionId;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId
      );

      verifyOwnership(subscription);

      if (
        !["canceled", "incomplete_expired"].includes(subscription.status)
      ) {
        return res.status(409).json({
          error: "Cancel membership payments before deleting this member",
        });
      }
    } else if (schedule && schedule.status !== "canceled") {
      return res.status(409).json({
        error: "Stripe billing must be reviewed before deletion",
      });
    }

    // Prevent an abandoned Checkout link being completed after deletion.
    if (registration.stripeCheckoutSessionId) {
      let session = await stripe.checkout.sessions.retrieve(
        registration.stripeCheckoutSessionId
      );

      verifyOwnership(session);

      if (session.status === "open") {
        await stripe.checkout.sessions.expire(session.id);
        session = await stripe.checkout.sessions.retrieve(session.id);
      }

      if (session.status === "open") {
        return res.status(409).json({
          error: "Payment setup is still open. Please retry deletion.",
        });
      }

      // A completed Checkout may still be awaiting its setup webhook.
      if (
        session.status === "complete" &&
        !registration.stripeScheduleId
      ) {
        return res.status(409).json({
          error:
            "Payment setup completed but no schedule is recorded. " +
            "Resolve setup and cancel its billing before deletion.",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      // Avoid deleting if a webhook changed the billing references
      // while we were checking Stripe.
      const current = await tx.consentForm.findUnique({
        where: { id: registration.id },
      });

      if (!current) {
        const error = new Error("Member not found");
        error.statusCode = 404;
        throw error;
      }

      for (const field of [
        "stripeCustomerId",
        "stripeScheduleId",
        "stripeSubscriptionId",
        "stripeCheckoutSessionId",
      ]) {
        if (current[field] !== registration[field]) {
          const error = new Error(
            "Billing details changed. Refresh the member and try again."
          );
          error.statusCode = 409;
          throw error;
        }
      }

      await tx.membershipInvoice.deleteMany({
        where: { registrationId: registration.id },
      });

      await tx.consentForm.delete({
        where: { id: registration.id },
      });
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete test member:", error);

    res.status(error.statusCode || 500).json({
      error:
        error.statusCode
          ? error.message
          : "Deletion could not be completed. Refresh and try again.",
    });
  }
});

router.get("/registrations.csv", requireAdmin, async (req, res) => {
  try {
    const forms = await prisma.consentForm.findMany({
      orderBy: { createdAt: "desc" },
    });

    const csvStringifier = createObjectCsvStringifier({
      header: [
      { id: "createdAt", title: "Created At" },
        { id: "ageGroup", title: "Age Group" },
        { id: "wwfcTeam", title: "WWFC Team" },
        
        { id: "playerFirstName", title: "Player First Name" },
        { id: "playerSurname", title: "Player Surname" },
        { id: "playerDob", title: "Player DOB" },
        { id: "playerSex", title: "Gender" },

        { id: "contact1Name", title: "Emergency Contact 1 Name" },
        { id: "contact1Dob", title: "Emergency Contact 1 DOB" },
        { id: "contact1PhoneNumber", title: "Emergency Contact 1 Phone" },
        { id: "contact1Postcode", title: "Emergency Contact 1 Postcode" },
        { id: "contact1HouseNumber", title: "Emergency Contact 1 House Number" },
        { id: "contact1Email", title: "Emergency Contact 1 Email" },
        { id: "contact1Relationship", title: "Emergency Contact 1 Relationship" },

        { id: "contact2Name", title: "Emergency Contact 2 Name" },
        { id: "contact2Dob", title: "Emergency Contact 2 DOB" },
        { id: "contact2PhoneNumber", title: "Emergency Contact 2 Phone" },
        { id: "contact2Postcode", title: "Emergency Contact 2 Postcode" },
        { id: "contact2HouseNumber", title: "Emergency Contact 2 House Number" },
        { id: "contact2Email", title: "Emergency Contact 2 Email" },
        { id: "contact2Relationship", title: "Emergency Contact 2 Relationship" },

      
        { id: "medicalInfo", title: "Medical Info" },
        { id: "allergies", title: "Allergies" },
        { id: "consentWalkHome", title: "Consent To Walk Home Alone" },
        { id: "consentData", title: "Contact Consent" },
        { id: "consentPhotos", title: "Photo Consent" },
        { id: "consentVideos", title: "Video Consent" },
        { id: "parentName", title: "Printed Name" },
        { id: "parentSignature", title: "Parent Signature" },
        { id: "signatureDate", title: "Signature Date" },
      ],
    });

    function formatDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-GB"); // DD/MM/YYYY
}

  const formattedForms = forms.map((f) => ({
      createdAt: formatDate(f.createdAt),
      ageGroup: String(f.ageGroup).toUpperCase(),
      wwfcTeam: f.wwfcTeam || "",
      consentWalkHome:
  f.consentWalkHome === null || f.consentWalkHome === undefined
    ? ""
    : f.consentWalkHome
      ? "Yes"
      : "No",
      playerFirstName: f.playerFirstName,
      playerSurname: f.playerSurname,
      playerDob: formatDate(f.playerDob),
      playerSex: f.playerSex,

      contact1Name: f.emergencyContact1?.name || "",
      contact1Dob: formatDate(f.emergencyContact1?.dob),
      contact1PhoneNumber: f.emergencyContact1?.phoneNumber || "",
      contact1Postcode: f.emergencyContact1?.postcode || "",
      contact1HouseNumber: f.emergencyContact1?.houseNumber || "",
      contact1Email: f.emergencyContact1?.email || "",
      contact1Relationship: f.emergencyContact1?.relationship || "",

      contact2Name: f.emergencyContact2?.name || "",
      contact2Dob: formatDate(f.emergencyContact2?.dob),
      contact2PhoneNumber: f.emergencyContact2?.phoneNumber || "",
      contact2Postcode: f.emergencyContact2?.postcode || "",
      contact2HouseNumber: f.emergencyContact2?.houseNumber || "",
      contact2Email: f.emergencyContact2?.email || "",
      contact2Relationship: f.emergencyContact2?.relationship || "",

      medicalInfo: f.medicalInfo || "",
      allergies: f.allergies || "",
      consentData: f.consentData ? "Yes" : "No",
      consentPhotos: f.consentPhotos ? "Yes" : "No",
      consentVideos: f.consentVideos ? "Yes" : "No",
      consentWalkHome:
  f.consentWalkHome === null || f.consentWalkHome === undefined
    ? ""
    : f.consentWalkHome
      ? "Yes"
      : "No",
      parentName: f.parentName || "",
      parentSignature: f.parentSignature || "",
      signatureDate: formatDate(f.signatureDate),
    }));

const csv =
  csvStringifier.getHeaderString() +
  csvStringifier.stringifyRecords(formattedForms);

    res.header("Content-Type", "text/csv");
const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
res.attachment(`wwfc-registrations-${today}.csv`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export CSV" });
  }
});
// Read the invoice history saved in our database.
router.get("/registrations/:id/invoices", requireAdmin, async (req, res) => {
  try {
    const registration = await prisma.consentForm.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });

    if (!registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    const invoices = await prisma.membershipInvoice.findMany({
      where: { registrationId: registration.id },
      orderBy: [
        { invoiceCreatedAt: "desc" },
        { stripeInvoiceId: "desc" },
      ],
    });

    res.json({ invoices });
  } catch (error) {
    console.error("Failed to load invoices:", error);
    res.status(500).json({ error: "Failed to load invoice history" });
  }
});

// Import or refresh one page of this registration's Stripe invoices.
router.post(
  "/registrations/:id/invoices/sync",
  requireAdmin,
  async (req, res) => {
    try {
      const cursor = req.body?.startingAfter;

      if (
        cursor !== undefined &&
        (typeof cursor !== "string" ||
          !/^in_[A-Za-z0-9]{1,200}$/.test(cursor))
      ) {
        return res.status(400).json({ error: "Invalid invoice cursor" });
      }

      const registration = await prisma.consentForm.findUnique({
        where: { id: req.params.id },
      });

      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (
        !registration.stripeCustomerId ||
        !registration.stripeSubscriptionId
      ) {
        return res.status(409).json({
          error: "This registration does not yet have a Stripe subscription",
        });
      }

      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(
        registration.stripeSubscriptionId
      );

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;

      if (
        subscription.livemode ||
        customerId !== registration.stripeCustomerId ||
        subscription.metadata?.registrationId !== registration.id
      ) {
        return res.status(409).json({
          error: "Stripe subscription does not match this registration",
        });
      }

      const page = await stripe.invoices.list({
        customer: registration.stripeCustomerId,
        subscription: registration.stripeSubscriptionId,
        limit: 10,
        ...(cursor ? { starting_after: cursor } : {}),
      });

      let syncedCount = 0;

      for (const invoice of page.data) {
        const saved = await syncMembershipInvoice(stripe, invoice.id);
        if (saved) syncedCount++;
      }

      res.json({
        syncedCount,
        hasMore: page.has_more,
        nextCursor: page.has_more
          ? page.data[page.data.length - 1]?.id
          : null,
      });
    } catch (error) {
      console.error("Failed to sync invoices:", error);
      res.status(500).json({
        error: "Invoice sync failed. Please try again.",
      });
    }
  }
);

router.post(
  "/registrations/:id/billing/cancel",
  requireAdmin,
  async (req, res) => {
    // Protect this cookie-authenticated action against cross-site requests.
    const frontendUrl = process.env.FRONTEND_URL;

    if (
      !req.trudashAdmin && (
        !frontendUrl ||
        req.get("origin") !== new URL(frontendUrl).origin
      )
    ) {
      return res.status(403).json({ error: "Invalid request origin" });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({
        error: "Cancellation confirmation is required",
      });
    }

    try {
      const registration = await prisma.consentForm.findUnique({
        where: { id: req.params.id },
      });

      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (
        !registration.stripeCustomerId ||
        (!registration.stripeScheduleId &&
          !registration.stripeSubscriptionId)
      ) {
        return res.status(409).json({
          error: "This registration has no scheduled or active billing",
        });
      }

      const stripe = getStripe();
      const objectId = (value) =>
        typeof value === "string" ? value : value?.id;

      function verifyOwnership(object) {
        if (
          object.livemode ||
          objectId(object.customer) !== registration.stripeCustomerId ||
          object.metadata?.registrationId !== registration.id
        ) {
          const error = new Error(
            "Stripe billing does not match this registration"
          );
          error.statusCode = 409;
          throw error;
        }
      }

      let schedule = null;

      if (registration.stripeScheduleId) {
        schedule = await stripe.subscriptionSchedules.retrieve(
          registration.stripeScheduleId
        );
        verifyOwnership(schedule);
      }

      const linkedSubscriptionId =
        objectId(schedule?.subscription) ||
        objectId(schedule?.released_subscription);

      if (
        linkedSubscriptionId &&
        registration.stripeSubscriptionId &&
        linkedSubscriptionId !== registration.stripeSubscriptionId
      ) {
        return res.status(409).json({
          error: "Stripe schedule and subscription do not match",
        });
      }

      const subscriptionId =
        registration.stripeSubscriptionId || linkedSubscriptionId;

      let subscription = null;

      if (subscriptionId) {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
        verifyOwnership(subscription);
      }

      if (
        schedule &&
        ["not_started", "active"].includes(schedule.status)
      ) {
        await stripe.subscriptionSchedules.cancel(schedule.id, {
          invoice_now: false,
          prorate: false,
        });
      } else if (
        subscription &&
        !["canceled", "incomplete_expired"].includes(subscription.status)
      ) {
        await stripe.subscriptions.cancel(subscription.id, {
          invoice_now: false,
          prorate: false,
        });
      } else if (!subscription && schedule?.status !== "canceled") {
        return res.status(409).json({
          error: "No cancellable subscription was found",
        });
      }

      // Check Stripe again before updating our database.
      let status = "canceled";

      if (subscriptionId) {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
        verifyOwnership(subscription);
        status = subscription.status;

        if (!["canceled", "incomplete_expired"].includes(status)) {
          throw new Error("Stripe cancellation has not completed");
        }
      }

      const updated = await prisma.consentForm.update({
        where: { id: registration.id },
        data: {
          stripeSubscriptionStatus: status,
          ...(subscriptionId
            ? { stripeSubscriptionId: subscriptionId }
            : {}),
        },
      });

      return res.json({
        registration: updated,
        message:
          "Membership payments cancelled. Registration and invoices retained.",
      });
    } catch (error) {
      console.error("Billing cancellation failed:", error);

      return res.status(error.statusCode || 500).json({
        error:
          error.statusCode === 409
            ? error.message
            : "Cancellation could not be confirmed. Please retry; " +
              "the same billing record will be checked again.",
      });
    }
  }
);
router.get("/members", requireAdmin, async (req, res) => {
  try {
    const registrations = await prisma.consentForm.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        invoices: {
          where: { status: "open" },
          select: {
            currency: true,
            amountRemainingPence: true,
          },
        },
      },
    });

    const members = registrations.map(
      ({ invoices, ...registration }) => {
        const gbpInvoices = invoices.filter(
          (invoice) => invoice.currency === "gbp"
        );

        return {
          ...registration,
          invoiceSummary: {
            outstandingPence: gbpInvoices.reduce(
              (total, invoice) =>
                total + invoice.amountRemainingPence,
              0
            ),
            openInvoiceCount: gbpInvoices.filter(
              (invoice) => invoice.amountRemainingPence > 0
            ).length,
          },
        };
      }
    );

    res.json({ members });
  } catch (error) {
    console.error("Failed to load members:", error);

    res.status(500).json({
      error: "Failed to load member directory",
    });
  }
});

// Resume card setup for a saved registration without creating another member.
router.post("/registrations/:id/payment-setup", requireAdmin, async (req, res) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL;
    if (!req.trudashAdmin && (!frontendUrl || req.get("origin") !== new URL(frontendUrl).origin)) {
      return res.status(403).json({ error: "Invalid request origin" });
    }
    const registration = await prisma.consentForm.findUnique({ where: { id: req.params.id } });
    if (!registration) return res.status(404).json({ error: "Member not found" });
    const checkoutUrl = await createRegistrationCheckout(registration);
    const updated = await prisma.consentForm.findUnique({ where: { id: registration.id } });
    res.json({ checkoutUrl, registration: updated });
  } catch (error) {
    console.error("Resume payment setup failed:", error.message);
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Payment setup could not start. Check the backend Stripe error log, then retry this member.",
    });
  }
});

module.exports = router;