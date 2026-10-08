const prisma = require("./prisma");

async function main() {
  const count = await prisma.consentForm.count();
  console.log("Consent forms in DB:", count);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
