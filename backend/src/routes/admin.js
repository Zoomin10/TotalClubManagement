const express = require("express");
const jwt = require("jsonwebtoken");
const { createObjectCsvStringifier } = require("csv-writer");
const prisma = require("../prisma");

const router = express.Router();

function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;

  if (!token) {
    return res.status(401).json({ error: "Admin login required" });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired admin session" });
  }
}

router.post("/login", (req, res) => {
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
    await prisma.consentForm.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete registration" });
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

module.exports = router;