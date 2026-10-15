import { useEffect, useState } from "react";
import "./App.css";
const api = import.meta.env.VITE_API_URL;
const names = {
  MATCHES_AND_TRAINING: "Matches & Training",
  TRAINING_ONLY: "Training only",
};
const initial = {
  paymentPlan: "",
  parentName: "",
  contacts: [],
  medicalInfo: "",
  allergies: "",
  medicalReviewed: false,
  medicalConsent: false,
  consentData: "",
  consentPhotos: "",
  consentVideos: "",
  consentWalkHome: "",
  detailsConfirmed: false,
  agreementAccepted: false,
};
export default function Renewal() {
  const token = window.location.pathname.split("/").at(-1);
  const [data, setData] = useState(null),
    [form, setForm] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.append(meta);
    const controller = new AbortController();
    fetch(`${api}/api/seasons/renew/${token}`, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setForm((f) => ({ ...f, contacts: d.contacts || [] }));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      controller.abort();
      meta.remove();
    };
  }, [token]);
  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(event, resume = false) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        ...Object.fromEntries(
          ["consentData", "consentPhotos", "consentVideos"].map((k) => [
            k,
            form[k] === "Yes",
          ]),
        ),
        consentWalkHome:
          form.consentWalkHome === "" ? null : form.consentWalkHome === "Yes",
      };
      const r = await fetch(
        `${api}/api/seasons/renew/${token}${resume ? "/checkout" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          referrerPolicy: "no-referrer",
          body: JSON.stringify(resume ? {} : payload),
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData((old) => ({
        ...old,
        accepted: true,
        paymentSetupRequired: Boolean(d.setupError || d.checkoutUrl),
      }));
      if (d.checkoutUrl) {
        const url = new URL(d.checkoutUrl);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
          throw Error("Unexpected payment setup URL");
        window.location.assign(url.href);
      } else if (d.setupError) setError(d.setupError);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <div
        className="card"
        style={{ maxWidth: 850, margin: "24px auto", padding: 24 }}
      >
        <h1>Renew club membership</h1>
        <p>
          <a href="/privacy-policy.html" target="_blank" rel="noreferrer">
            Club privacy notice
          </a>
        </p>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p>Loading your renewal…</p>}
        {data && (
          <>
            <h2>Season {data.season.label}</h2>
            <p>
              Monthly payments run from 1 June to 1 May. There is no payment
              today. A new season requires your agreement; leaving the club
              stops future payments, with existing arrears handled separately.
            </p>
            {data.accepted ? (
              <section>
                <h3>Renewal accepted</h3>
                <p>
                  {data.paymentSetupRequired
                    ? "Complete card setup to schedule the new season’s payments."
                    : "Your payment setup has been completed. Contact the club if you need help."}
                </p>
                {data.paymentSetupRequired && (
                  <button disabled={busy} onClick={(e) => submit(e, true)}>
                    {busy ? "Opening…" : "Resume payment setup"}
                  </button>
                )}
              </section>
            ) : (
              <form onSubmit={submit}>
                <h3>
                  {data.player.firstName} {data.player.surname} ·{" "}
                  {data.player.team}
                </h3>
                <label>
                  Payment plan
                  <select
                    required
                    value={form.paymentPlan}
                    onChange={(e) => field("paymentPlan", e.target.value)}
                  >
                    <option value="">Choose a plan</option>
                    {data.season.plans.map((p) => (
                      <option key={p.paymentPlan} value={p.paymentPlan}>
                        {names[p.paymentPlan]} — £
                        {(p.amountPence / 100).toFixed(2)} per month
                      </option>
                    ))}
                  </select>
                </label>
                {form.contacts.map((contact, index) => (
                  <fieldset key={index}>
                    <legend>Parent / emergency contact {index + 1}</legend>
                    {[
                      "name",
                      "email",
                      "phoneNumber",
                      "postcode",
                      "houseNumber",
                    ].map((key) => (
                      <label key={key}>
                        {
                          {
                            name: "Name",
                            email: "Email",
                            phoneNumber: "Telephone",
                            postcode: "Postcode",
                            houseNumber: "House number",
                          }[key]
                        }
                        <input
                          required
                          maxLength={key === "email" ? 150 : 100}
                          type={key === "email" ? "email" : "text"}
                          value={contact[key]}
                          onChange={(e) =>
                            field(
                              "contacts",
                              form.contacts.map((c, i) =>
                                i === index
                                  ? { ...c, [key]: e.target.value }
                                  : c,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Relationship
                      <select
                        required
                        value={contact.relationship}
                        onChange={(e) =>
                          field(
                            "contacts",
                            form.contacts.map((c, i) =>
                              i === index
                                ? { ...c, relationship: e.target.value }
                                : c,
                            ),
                          )
                        }
                      >
                        {["", "Mother", "Father", "Carer"].map((v) => (
                          <option key={v} value={v}>
                            {v || "Select relationship"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                ))}
                <h3>Fresh medical declaration</h3>
                <p>
                  Declare current conditions or allergies, or leave both blank
                  if there are none. Previous medical details are not displayed
                  here.
                </p>
                {["medicalInfo", "allergies"].map((k) => (
                  <label key={k}>
                    {k === "medicalInfo" ? "Medical conditions" : "Allergies"}
                    <textarea
                      maxLength={1000}
                      value={form[k]}
                      onChange={(e) => field(k, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  <input
                    required
                    type="checkbox"
                    checked={form.medicalReviewed}
                    onChange={(e) => field("medicalReviewed", e.target.checked)}
                  />{" "}
                  I have reviewed this declaration and confirm it is current,
                  including if there are no conditions or allergies.
                </label>
                <label>
                  <input
                    type="checkbox"
                    required={Boolean(
                      form.medicalInfo.trim() || form.allergies.trim(),
                    )}
                    checked={form.medicalConsent}
                    onChange={(e) => field("medicalConsent", e.target.checked)}
                  />{" "}
                  I explicitly consent to the club recording the health
                  information I declare for player safety, as explained in the
                  club privacy notice. I can withdraw consent by contacting the
                  club.
                </label>
                <h3>Permissions for this season</h3>
                {[
                  ["consentData", "May the club contact you?"],
                  ["consentPhotos", "Photo permission"],
                  ["consentVideos", "Video permission"],
                  ["consentWalkHome", "May the player walk home alone?"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      required={key !== "consentWalkHome"}
                      value={form[key]}
                      onChange={(e) => field(key, e.target.value)}
                    >
                      <option value="">
                        {key === "consentWalkHome"
                          ? "Not applicable"
                          : "Choose"}
                      </option>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </label>
                ))}
                <h3>Season terms — {data.season.termsVersion}</h3>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    border: "1px solid #ccd",
                    padding: 16,
                  }}
                >
                  {data.season.termsContent}
                </div>
                <label>
                  Parent / carer name (electronic signature)
                  <input
                    required
                    maxLength={100}
                    value={form.parentName}
                    onChange={(e) => field("parentName", e.target.value)}
                  />
                </label>
                <label>
                  <input
                    required
                    type="checkbox"
                    checked={form.detailsConfirmed}
                    onChange={(e) =>
                      field("detailsConfirmed", e.target.checked)
                    }
                  />{" "}
                  I confirm the member and contact details are correct.
                </label>
                <label>
                  <input
                    required
                    type="checkbox"
                    checked={form.agreementAccepted}
                    onChange={(e) =>
                      field("agreementAccepted", e.target.checked)
                    }
                  />{" "}
                  I accept these season terms and authorise the selected monthly
                  fee from 1 June through 1 May.
                </label>
                <button disabled={busy}>
                  {busy ? "Saving…" : "Accept renewal and set up payments"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
