// Browser-visible member fields. Medical declarations remain in storage and the
// explicitly authorised full export, never in ordinary directory/billing JSON.
const memberFields = [
  'id','createdAt','ageGroup','wwfcTeam','playerFirstName','playerSurname',
  'playerDob','playerSex','emergencyContact1','emergencyContact2','postcode',
  'houseNumber','email','photoUrl','consentData','consentPhotos','consentVideos',
  'consentWalkHome','parentSignature','parentName','signatureDate','stripeScheduleId',
  'paymentPlan','monthlyAmountPence','firstPaymentDate','stripeCustomerId',
  'stripeSubscriptionId','stripeCheckoutSessionId','stripeSubscriptionStatus',
];
const memberSelect = Object.fromEntries(memberFields.map(field => [field, true]));
function memberView(member) {
  if (!member) return member;
  return Object.fromEntries(memberFields.filter(field => Object.hasOwn(member, field)).map(field => [field, member[field]]));
}
module.exports = { memberSelect, memberView };
