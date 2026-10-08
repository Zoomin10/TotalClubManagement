import { useState } from "react";
import "./App.css";
import Admin from "./Admin";

const API_URL = import.meta.env.VITE_API_URL;

const initialForm = {
  ageGroup: "",
  wwfcTeam: "",
  playerFirstName: "",
  playerSurname: "",
  playerDob: "",
  playerSex: "",

  emergencyContact1: {
    name: "",
    dob: "",
    phoneNumber: "",
    postcode: "",
    houseNumber: "",
    email: "",
    relationship: "",
  },

  emergencyContact2: {
    name: "",
    dob: "",
    phoneNumber: "",
    postcode: "",
    houseNumber: "",
    email: "",
    relationship: "",
  },

  postcode: "",
  houseNumber: "",
  email: "",
  medicalInfo: "",
  allergies: "",

  consentData: "",
  consentPhotos: "",
  consentVideos: "",
  consentWalkHome: "",

  parentSignature: "",
  parentName: "",
  signatureDate: "",

  acceptedPrivacyPolicy: false,
};

function App() {
    if (window.location.pathname === "/admin") {
  return <Admin />;
}
  const [form, setForm] = useState(initialForm);
const [status, setStatus] = useState("");
const [validationError, setValidationError] = useState("");
const walkHomeEligible =
  Number(String(form.ageGroup).replace("u", "")) >= 11;
 function updateField(name, value) {
  setForm((prev) => {
    const next = {
      ...prev,
      [name]: value,
    };

    if (name === "ageGroup") {
      const age = Number(String(value).replace("u", ""));

      if (age < 11) {
        next.consentWalkHome = "";
      }
    }

    return next;
  });
}

  function updateContact(contactKey, field, value) {
    setForm((prev) => ({
      ...prev,
      [contactKey]: {
        ...prev[contactKey],
        [field]: value,
      },
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("Submitting...");

    const payload = {
      ...form,
      wwfcTeam: form.wwfcTeam,
      consentData: form.consentData === "Yes",
      consentPhotos: form.consentPhotos === "Yes",
      consentVideos: form.consentVideos === "Yes",
      consentWalkHome: walkHomeEligible
  ? form.consentWalkHome === "Yes"
  : null,
    };

    try {
      const res = await fetch(`${API_URL}/api/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

if (!res.ok) {
  try {
    const errorData = await res.json();

    const fieldErrors = errorData?.details?.fieldErrors;

    if (fieldErrors) {
      const firstError = Object.values(fieldErrors)
        .flat()
        .find(Boolean);

      setValidationError(firstError || "");
    }
  } catch (err) {
    console.error(err);
  }

  setStatus(
    "Some of the information entered appears to be incomplete or incorrect. Please review the form and ensure all required details are accurate."
  );

  return;
}
setValidationError("");
setStatus("Consent form submitted successfully.");
setForm(initialForm);
} catch (err) {
  console.error(err);
  setStatus(
    "Sorry, we could not submit the form right now. Please try again in a few minutes."
  );
}
  }

  return (
    <main className="page">
      <section className="card">
        <img src="/wwfc-letter-head.png" alt="Wroughton & Wichelstowe Football Club" className="logo" />

        <h1>Player Digital Consent Form</h1>
        <p className="intro">
          Please complete this form for Wroughton & Wichelstowe Football Club.
        </p>

        <form onSubmit={handleSubmit}>
          <h2>Player Details</h2>

          <div className="grid">
            <label>
              Age Group
            <select
  required
  value={form.ageGroup}
  onChange={(e) => updateField("ageGroup", e.target.value)}
>
  <option value="">Please Select</option>

  {["u7","u8","u9","u10","u11","u12","u13","u14","u15","u16","u17","u18","adult"].map((age) => (
    <option key={age} value={age}>
      {age.toUpperCase()}
    </option>
  ))}
</select>
            </label>

<label>
  WWFC Team
  <select
    required
    value={form.wwfcTeam}
    onChange={(e) => updateField("wwfcTeam", e.target.value)}
  >
    <option value="">Select Team</option>
<option>Rebels</option>
    <option>Black Cats</option>
    <option>Wild Cats</option>
    <option>Panthers</option>
    <option>Rams</option>
    <option>Rhinos</option>
      <option>Rangers</option>
    <option>Rockets</option>
    <option>Dragons</option>
    <option>Thunder</option>
       <option>Foxes</option>
      <option>Lightning</option>
    <option>Wookies</option>
    <option>Warriors</option>
    <option>Magic</option>
      <option>Witches</option>
    <option>Lions</option>
    <option>Wasps</option>
    <option>Wolves</option>
      <option>Hurricanes</option>
    <option>Tornadoes</option>
    <option>Silverbacks</option>
    <option>Broncos</option>   
    <option>Wrens</option>
    <option>Ravens</option>
       <option>U18</option>
       <option>Mens</option>
        <option>Other (not listed)</option>

    {/* etc */}
  </select>
</label>

            <label>
              Gender
          <select
  required
  value={form.playerSex}
  onChange={(e) => updateField("playerSex", e.target.value)}
>
  <option value="">Please Select</option>
  <option value="Male">Male</option>
  <option value="Female">Female</option>
</select>
            </label>

            <label>
              First Name
              <input required value={form.playerFirstName} onChange={(e) => updateField("playerFirstName", e.target.value)} />
            </label>

            <label>
              Surname
              <input required value={form.playerSurname} onChange={(e) => updateField("playerSurname", e.target.value)} />
            </label>

            <label>
              Date of Birth
              <input required type="date" value={form.playerDob} onChange={(e) => updateField("playerDob", e.target.value)} />
            </label>
          </div>

          <ContactSection title="Emergency Contact 1" data={form.emergencyContact1} onChange={(field, value) => updateContact("emergencyContact1", field, value)} />
          <ContactSection title="Emergency Contact 2" data={form.emergencyContact2} onChange={(field, value) => updateContact("emergencyContact2", field, value)} />

          <h2>Medical Information</h2>

          <label>
            Important Medical Information, including medication and times to be administered
            <textarea required value={form.medicalInfo} onChange={(e) => updateField("medicalInfo", e.target.value)} />
          </label>

          <label>
            Allergies, including food intolerances
            <textarea value={form.allergies} onChange={(e) => updateField("allergies", e.target.value)} />
          </label>

          <h2>Permissions</h2>

          <YesNo label="I give permission for these details to be kept by Wroughton & Wichelstowe FC for contact purposes." value={form.consentData} onChange={(v) => updateField("consentData", v)} />
          <YesNo label="I give permission for photographs to be taken and used by Wroughton & Wichelstowe FC." value={form.consentPhotos} onChange={(v) => updateField("consentPhotos", v)} />
          <YesNo label="I give permission for videos to be taken and used by Wroughton & Wichelstowe FC." value={form.consentVideos} onChange={(v) => updateField("consentVideos", v)} />
{walkHomeEligible && (
  <YesNo
    label="I give permission for my child to leave training, matches, or club activities unaccompanied and make their own way home."
    value={form.consentWalkHome}
    onChange={(v) => updateField("consentWalkHome", v)}
  />
)}

          <p className="disclaimer">
              Wroughton & Wichelstowe FC adhere to the England FA guidelines for the use of photos and videos, safeguarding and social media. 
  For more information, please see the FA guidance for parents and carers{" "}
  <a 
    href="https://www.thefa.com/football-rules-governance/safeguarding/section-8-parents-and-carers" 
    target="_blank" 
    rel="noreferrer"
  >
    here
  </a>.
          </p>

        <h2>
  {form.ageGroup === "adult"
    ? "Player Signature"
    : "Parent / Carer Signature"}
</h2>

          <div className="grid">
            <label>
  {form.ageGroup === "adult"
    ? "Player Signature"
    : "Parent / Carer Signature"}

  <input
    required
    value={form.parentSignature}
    onChange={(e) =>
      updateField("parentSignature", e.target.value)
    }
  />
</label>

           <label>
  {form.ageGroup === "adult"
    ? "Player Name"
    : "Parent / Carer Name"}

  <input
    required
    value={form.parentName}
    onChange={(e) =>
      updateField("parentName", e.target.value)
    }
  />
</label>

            <label>
              Date of Signature
              <input
  required
  type="date"
  max={new Date().toISOString().split("T")[0]}
  value={form.signatureDate}
  onChange={(e) => updateField("signatureDate", e.target.value)}
/>
            </label>
          </div>

<label className="privacy-check">
  <input
    type="checkbox"
    checked={form.acceptedPrivacyPolicy}
    onChange={(e) => updateField("acceptedPrivacyPolicy", e.target.checked)}
    required
  />
  <span>
    I have read and accept the{" "}
    <a href="/privacy-policy.html" target="_blank" rel="noreferrer">
      Privacy Policy
    </a>
    .
  </span>
</label>
        <button type="submit" disabled={!form.acceptedPrivacyPolicy}>
  Submit Consent Form
</button>

          {status && <p className="status">{status}</p>}

{validationError && (
  <p className="validation-error">
    {validationError}
  </p>
)}
        </form>
      </section>
    </main>
  );
}

function ContactSection({ title, data, onChange }) {
  return (
    <>
      <h2>{title}</h2>
      <div className="grid">
        {[
  ["name", "Name"],
  ["dob", "Date of Birth"],
  ["phoneNumber", "Phone Number"],
  ["postcode", "Post Code"],
  ["houseNumber", "House Number"],
  ["email", "Email Address"],
].map(([field, label]) => (
  <label key={field}>
    {label}
    <input
      required
      type={field === "dob" ? "date" : field === "email" ? "email" : "text"}
      value={data[field]}
      onChange={(e) => onChange(field, e.target.value)}
    />
  </label>
))}

<label>
  Relationship to Player
  <select
    required
    value={data.relationship}
    onChange={(e) => onChange("relationship", e.target.value)}
  >
    <option value="">Select...</option>
    <option value="Mother">Mother</option>
    <option value="Father">Father</option>
    <option value="Carer">Carer</option>
  </select>
</label>
      </div>
    </>
  );
}

function YesNo({ label, value, onChange }) {
  return (
    <label>
      {label}
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select...</option>
        <option>Yes</option>
        <option>No</option>
      </select>
    </label>
  );
}

export default App;