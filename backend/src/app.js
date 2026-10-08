const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const consentRoutes = require("./routes/consent");
const adminRoutes = require("./routes/admin");

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "https://wwfc-consent-form-development.up.railway.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
     if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
      credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: [
      "Content-Disposition",
        ],
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/consent", consentRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "WWFC consent backend" });
});

module.exports = app;
