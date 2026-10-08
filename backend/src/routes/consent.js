const express = require("express");
const { z } = require("zod");
const router = express.Router();
const prisma = require("../prisma");

const ageGroups = [
  "u7",
  "u8",
  "u9",
  "u10",
  "u11",
  "u12",
  "u13",
  "u14",
  "u15",
  "u16",
  "u17",
  "u18",
  "adult",
];

const {
  sendRegistrationNotification,
} = require("../services/notificationService");

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
 dob: z.coerce.date().refine(
  (date) => date <= new Date(),
  {
    message: "Date of birth cannot be in the future",
  }
),
 phoneNumber: z
  .string()
  .trim()
  .regex(
    /^(\+44|0)[\d\s()-]{9,18}$/,
    "Please enter a valid UK telephone number"
  ),
postcode: z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/,
    "Please enter a valid UK postcode"
  ),
  houseNumber: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(150),
  relationship: z.enum([
  "Mother",
  "Father",
  "Carer",
]),
});


const consentFormSchema = z.object({
  ageGroup: z.enum(ageGroups),
wwfcTeam: z.string().trim().min(1).max(100),
  playerFirstName: z.string().trim().min(1).max(60),
  playerSurname: z.string().trim().min(1).max(60),
playerDob: z.coerce.date().refine(
  (date) => date <= new Date(),
  {
    message: "Player date of birth cannot be in the future",
  }
),
  playerSex: z.enum(["Male", "Female"]),

  emergencyContact1: contactSchema,
  emergencyContact2: contactSchema,

postcode: z.string().trim().max(12).optional().default(""),
houseNumber: z.string().trim().max(50).optional().default(""),
email: z.union([
  z.string().trim().email().max(150),
  z.literal("")
]).optional().default(""),

  medicalInfo: z.string().trim().max(1000).default(""),
  allergies: z.string().trim().max(1000).optional().nullable(),

  photoUrl: z.string().trim().url().optional().nullable(),

  consentData: z.boolean(),
  consentPhotos: z.boolean(),
  consentVideos: z.boolean(),
consentWalkHome: z.boolean().nullable().optional(),
  parentSignature: z.string().trim().min(1).max(100),
  parentName: z.string().trim().min(1).max(100),
  signatureDate: z.coerce.date().refine(
  (date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date <= today;
  },
  {
    message: "Signature date cannot be in the future",
  }
),
});

// Create new consent form
router.post("/", async (req, res) => {
  try {
    const parsed = consentFormSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid consent form data",
        details: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    const result = await prisma.consentForm.create({
      data: {
        ageGroup: data.ageGroup,
        wwfcTeam: data.wwfcTeam,
        playerFirstName: data.playerFirstName,
        playerSurname: data.playerSurname,
        playerDob: data.playerDob,
        playerSex: data.playerSex,

        emergencyContact1: data.emergencyContact1,
        emergencyContact2: data.emergencyContact2,

        postcode: data.postcode,
        houseNumber: data.houseNumber,
        email: data.email,

        medicalInfo: data.medicalInfo,
        allergies: data.allergies || null,

        photoUrl: data.photoUrl || null,

        consentData: data.consentData,
        consentPhotos: data.consentPhotos,
        consentVideos: data.consentVideos,
        consentWalkHome: data.consentWalkHome ?? null,

        parentSignature: data.parentSignature,
        parentName: data.parentName,
        signatureDate: data.signatureDate,
      },
    });

      sendRegistrationNotification(result).catch((error) => {
      console.error(
        "Registration saved, but notification email failed:",
        error
      );
    });

    res.status(201).json(result);
  } catch (err) {
    console.error("Failed to save consent form:", err);

    res.status(500).json({
      error: "Failed to save consent form",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const { ageGroup, playerSex } = req.query;

    const forms = await prisma.consentForm.findMany({
      where: {
        ageGroup: ageGroup || undefined,
        playerSex: playerSex || undefined,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(forms);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch forms" });
  }
});

module.exports = router;