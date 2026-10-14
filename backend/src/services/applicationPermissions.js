const volunteers = require('./volunteerService');
const permissionOptions = [
  {key:'MEMBERS_MANAGE',label:'Manage member registrations and payments'},
  {key:'VOLUNTEERS_MANAGE',label:'Manage volunteer records'},
  {key:'FINANCE_DETAILS',label:'View named payment and arrears details'},
  {key:'WELFARE_DETAILS',label:'View individual welfare and complaint records'},
  {key:'SOURCE_REPORTS',label:'View source report links'},
  {key:'FULL_CSV_EXPORT',label:'Download full member CSV including medical declarations'},
];
async function applicationAccess(identity, db = volunteers.prisma) {
  const bootstrap = identity.volunteerSuperAdmin === true;
  const actor = await db.clubVolunteer.findUnique({where:{email:identity.username},include:{acceptances:true}});
  if (!actor || actor.status !== 'ACTIVE' || volunteers.currentAcceptances(actor).length) return bootstrap ? {permissions:['VOLUNTEERS_MANAGE'],superAdmin:true} : {permissions:[],superAdmin:false};
  const allowed = new Set(permissionOptions.map(p=>p.key));
  const permissions = [...new Set((actor.applicationPermissions || []).filter(p=>allowed.has(p)))];
  const superAdmin = bootstrap || actor.accessRole === 'SUPER_ADMIN';
  if (superAdmin && !permissions.includes('VOLUNTEERS_MANAGE')) permissions.push('VOLUNTEERS_MANAGE');
  return {permissions,superAdmin};
}
module.exports = {applicationAccess,permissionOptions};
