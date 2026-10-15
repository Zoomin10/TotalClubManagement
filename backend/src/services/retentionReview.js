const {DateTime}=require('luxon');
const zone='Europe/London';
function reviewRecord(record,now=new Date()){
 const registered=DateTime.fromJSDate(new Date(record.createdAt),{zone});
 const today=DateTime.fromJSDate(new Date(now),{zone});
 const valid=registered.isValid&&registered.toMillis()<=today.toMillis();
 const startYear=valid?(registered.month>=6?registered.year:registered.year-1):null;
 const end=valid?DateTime.fromObject({year:startYear+1,month:5,day:31},{zone}).endOf('day'):null;
 const proposedReview=end?.plus({years:1});
 const state=!valid?'CHECK_REGISTRATION_DATE':today.toMillis()<=end.toMillis()?'CURRENT_INFERRED_SEASON':today.toMillis()<=proposedReview.toMillis()?'REVIEW_RENEWAL':'REVIEW_OLD_REGISTRATION';
 return {
  id:record.id,playerFirstName:record.playerFirstName,playerSurname:record.playerSurname,
  team:record.wwfcTeam||null,registeredAt:record.createdAt,
  inferredSeason:startYear===null?null:`${startYear}/${String(startYear+1).slice(-2)}`,
  seasonEnd:end?.toISODate()||null,
  proposedArchiveReviewDate:proposedReview?.toISODate()||null,
  state,seasonBasis:'REGISTRATION_DATE_ONLY',renewalStatus:'UNCONFIRMED',
  billingReviewRequired:Boolean(record.stripeScheduleId||record.stripeSubscriptionId||record.stripeSubscriptionStatus),
  openInvoiceCount:record._count?.invoices||0,
  deletionEligible:false,
 };
}
async function retentionReview(prisma,now=new Date()){
 const records=await prisma.consentForm.findMany({
  select:{id:true,createdAt:true,playerFirstName:true,playerSurname:true,wwfcTeam:true,
   stripeScheduleId:true,stripeSubscriptionId:true,stripeSubscriptionStatus:true,
   _count:{select:{invoices:{where:{status:'open',amountRemainingPence:{gt:0}}}}}},
  orderBy:{createdAt:'asc'},
 });
 const members=records.map(record=>reviewRecord(record,now));
 const counts={total:members.length,currentInferredSeason:0,reviewRenewal:0,reviewOldRegistration:0,checkRegistrationDate:0};
 for(const member of members){const key={CURRENT_INFERRED_SEASON:'currentInferredSeason',REVIEW_RENEWAL:'reviewRenewal',REVIEW_OLD_REGISTRATION:'reviewOldRegistration',CHECK_REGISTRATION_DATE:'checkRegistrationDate'}[member.state];counts[key]++;}
 return {generatedAt:new Date(now).toISOString(),timeZone:zone,seasonEnd:'31 May',proposedArchiveMonths:12,
  destructiveActionsEnabled:false,
  notice:'Read-only review. This report infers seasons from original registration dates only. Check confirmed renewals and departures in Seasons & renewals; they are not incorporated in this report yet. Archive dates and record holds require separate confirmation before retention decisions. The 12-month archive period is a proposal.',
  counts,members};
}
module.exports={reviewRecord,retentionReview};
