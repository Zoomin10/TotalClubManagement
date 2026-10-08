const { Resend } = require("resend");
const { buildRegistrationEmail } = require("./notificationTemplates");

function getRecipients() {
  return String(process.env.EMAIL_TO || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }

  return new Resend(process.env.RESEND_API_KEY);
}

async function sendRegistrationNotification(registration) {
  const resend = getResendClient();
  const recipients = getRecipients();

  if (!resend) {
    console.warn(
      "Registration notification skipped: RESEND_API_KEY is not configured.",
    );
    return { skipped: true, reason: "missing_api_key" };
  }

  if (!process.env.EMAIL_FROM) {
    console.warn(
      "Registration notification skipped: EMAIL_FROM is not configured.",
    );
    return { skipped: true, reason: "missing_sender" };
  }

  if (recipients.length === 0) {
    console.warn(
      "Registration notification skipped: EMAIL_TO is not configured.",
    );
    return { skipped: true, reason: "missing_recipients" };
  }

  const playerName =
    `${registration.playerFirstName || ""} ${registration.playerSurname || ""}`.trim();

  const team = registration.wwfcTeam || "Team not specified";

  const payload = {
    from: process.env.EMAIL_FROM,
    to: recipients,
    subject: `WWFC Registration | ${playerName} | ${team}`,
  html: buildRegistrationEmail(registration, {
    adminUrl: process.env.ADMIN_URL,
}),
  };

  if (process.env.REPLY_TO_EMAIL) {
    payload.replyTo = process.env.REPLY_TO_EMAIL;
  }

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    throw new Error(
      `Resend rejected registration notification: ${
        error.message || JSON.stringify(error)
      }`,
    );
  }

  console.log("Registration notification email sent:", {
    emailId: data?.id,
    player: playerName,
    recipients,
  });

  return {
    skipped: false,
    emailId: data?.id,
  };
}

module.exports = {
  sendRegistrationNotification,
};