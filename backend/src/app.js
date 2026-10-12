const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const consentRoutes = require("./routes/consent");
const adminRoutes = require("./routes/admin");
const stripeWebhookRoutes = require("./routes/stripeWebhook");
const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.NODE_ENV !== "production"
    ? ["http://localhost:5173"]
    : []),
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
  })
);
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/volunteers", require("./routes/volunteers"));
app.use("/api/consent", consentRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "TotalClubManagement backend",
  });
});

module.exports = app;