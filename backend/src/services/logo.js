const fs = require("fs");
const path = require("path");

const logoPath = path.join(
  __dirname,
  "../assets/wwfc-letter-head.png"
);

const logoBase64 = fs.readFileSync(logoPath).toString("base64");

module.exports = {
  logoDataUri: `data:image/png;base64,${logoBase64}`,
};