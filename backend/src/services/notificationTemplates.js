const { logoDataUri } = require("./logo");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not provided";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not provided";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

function detailRow(label, value) {
  return `
    <tr>
      <td
        width="38%"
        valign="top"
        style="
          padding: 9px 10px;
          color: #4d5b86;
          font-size: 15px;
          line-height: 1.4;
          border-bottom: 1px solid #e6eaf2;
        "
      >
        ${escapeHtml(label)}
      </td>

      <td
        valign="top"
        style="
          padding: 9px 10px;
          color: #10245c;
          font-size: 15px;
          line-height: 1.4;
          font-weight: 700;
          border-bottom: 1px solid #e6eaf2;
          word-break: break-word;
        "
      >
        ${escapeHtml(value || "Not provided")}
      </td>
    </tr>
  `;
}

function section(title, rows) {
  return `
    <tr>
      <td style="padding: 10px 20px 0;">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            overflow: hidden;
          "
        >
          <tr>
            <td
              colspan="2"
              style="
                padding: 12px 14px;
                background: #eef2ff;
                color: #153ea3;
                font-size: 17px;
                line-height: 1.3;
                font-weight: 700;
              "
            >
              ${escapeHtml(title)}
            </td>
          </tr>

          ${rows}
        </table>
      </td>
    </tr>
  `;
}

function buildRegistrationEmail(registration, options = {}) {
  const adminUrl = options.adminUrl || "#";
  const logoUrl = options.logoUrl || "";
  const playerName =
    `${registration.playerFirstName || ""} ${registration.playerSurname || ""}`.trim();

  const contact1 = registration.emergencyContact1 || {};

  const logoMarkup = logoUrl
    ? `
     
  <img
  src="${logoDataUri}"
  alt="Wroughton & Wichelstowe Football Club"
  width="300"
  style="
    display:block;
    width:100%;
    max-width:300px;
    height:auto;
    margin:0 auto;
    border:0;
  "
/>
    `
    : `
      <div
        style="
          color: #10245c;
          font-size: 22px;
          line-height: 1.3;
          font-weight: 700;
          text-align: center;
        "
      >
        Wroughton &amp; Wichelstowe Football Club
      </div>
    `;

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <style>
    @media only screen and (max-width: 620px) {
      .email-shell {
        width: 100% !important;
      }

      .email-padding {
        padding-left: 14px !important;
        padding-right: 14px !important;
      }

      .dashboard-button {
        display: block !important;
        width: auto !important;
      }
    }
  </style>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background: #f4f6fb;
    font-family: Arial, Helvetica, sans-serif;
  "
>
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="width: 100%; background: #f4f6fb;"
  >
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table
          role="presentation"
          width="620"
          cellspacing="0"
          cellpadding="0"
          border="0"
          class="email-shell"
          style="
            width: 100%;
            max-width: 620px;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 8px 30px rgba(15, 35, 85, 0.12);
          "
        >
          <tr>
            <td
              align="center"
              class="email-padding"
              style="
                padding: 24px 20px 18px;
                border-bottom: 3px solid #153ea3;
              "
            >
              ${logoMarkup}
            </td>
          </tr>

          <tr>
            <td
              align="center"
              class="email-padding"
              style="padding: 24px 20px 10px;"
            >
              <div
                style="
                  display: inline-block;
                  padding: 7px 12px;
                  background: #e8f7ed;
                  color: #176b35;
                  border-radius: 999px;
                  font-size: 14px;
                  line-height: 1.2;
                  font-weight: 700;
                "
              >
                New registration received
              </div>

              <h1
                style="
                  margin: 16px 0 8px;
                  color: #10245c;
                  font-size: 26px;
                  line-height: 1.25;
                "
              >
                New Player Registration
              </h1>

              <p
                style="
                  margin: 0;
                  color: #4d5b86;
                  font-size: 16px;
                  line-height: 1.5;
                "
              >
                A new WWFC digital consent form has been submitted.
              </p>
            </td>
          </tr>

          ${section(
            "Player details",
            [
              detailRow("Player", playerName),
              detailRow("WWFC team", registration.wwfcTeam),
              detailRow(
                "Age group",
                String(registration.ageGroup || "").toUpperCase(),
              ),
              detailRow("Gender", registration.playerSex),
              detailRow("Date of birth", formatDate(registration.playerDob)),
            ].join(""),
          )}

          ${section(
            "Parent / guardian",
            [
              detailRow("Name", contact1.name),
              detailRow("Telephone", contact1.phoneNumber),
              detailRow("Email", contact1.email),
            ].join(""),
          )}

          ${section(
            "Submission",
            detailRow(
              "Received",
              formatDateTime(registration.createdAt || new Date()),
            ),
          )}

          <tr>
            <td
              align="center"
              class="email-padding"
              style="padding: 26px 20px 10px;"
            >
              <a
                href="${escapeHtml(adminUrl)}"
                class="dashboard-button"
                style="
                  display: inline-block;
                  padding: 15px 24px;
                  background: #153ea3;
                  color: #ffffff;
                  text-decoration: none;
                  border-radius: 9px;
                  font-size: 16px;
                  line-height: 1.2;
                  font-weight: 700;
                  text-align: center;
                "
              >
                Open Admin Dashboard
              </a>
            </td>
          </tr>

          <tr>
            <td
              class="email-padding"
              style="padding: 18px 20px 26px;"
            >
              <p
                style="
                  margin: 0;
                  color: #667085;
                  font-size: 13px;
                  line-height: 1.5;
                  text-align: center;
                "
              >
                Medical information, allergies, addresses and consent answers
                are intentionally excluded from this email. View the secure
                admin dashboard for the full registration.
              </p>
            </td>
          </tr>

          <tr>
            <td
              align="center"
              style="
                padding: 18px 20px;
                background: #10245c;
                color: #ffffff;
              "
            >
              <p
                style="
                  margin: 0 0 6px;
                  font-size: 13px;
                  line-height: 1.5;
                "
              >
                This is an automated email from the WWFC Player Registration System.
              </p>

              <p
                style="
                  margin: 0;
                  font-size: 13px;
                  line-height: 1.5;
                "
              >
                Wroughton &amp; Wichelstowe Football Club
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

module.exports = {
  buildRegistrationEmail,
};