require('dotenv').config({quiet:true});
const fs=require('node:fs');
const volunteers=require('../src/services/volunteerService');
const {permissionOptions}=require('../src/services/applicationPermissions');
const allowed=new Set(permissionOptions.map(p=>p.key));
async function main(){
 const file=process.argv[2];if(!file)throw Error('Usage: node scripts/import-application-permissions.cjs reviewed-permissions.json [--apply]');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(input.grants))throw Error('Expected grants array');
 const seen=new Set();
 const grants=input.grants.map(g=>{
  if(typeof g.email!=='string'||!/^[^\s@]+@[^\s@]+$/.test(g.email)||!Array.isArray(g.permissions)||g.permissions.some(p=>!allowed.has(p)))throw Error('Invalid email or permission');
  const email=g.email.trim().toLowerCase();if(seen.has(email))throw Error('Duplicate email');seen.add(email);
  return {email,permissions:[...new Set(g.permissions)]};
 });
 const plan=[];
 for(const grant of grants){
  const v=await volunteers.prisma.clubVolunteer.findUnique({where:{email:grant.email},include:{acceptances:true}});
  const reason=!v?'No volunteer record':v.status!=='ACTIVE'?'Volunteer is not Active':volunteers.currentAcceptances(v).length?'Current agreements required':null;
  plan.push({...grant,status:reason?'BLOCKED':'READY',reason});
 }
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',plan},null,2));
 if(!process.argv.includes('--apply'))return;
 if(plan.some(p=>p.status==='BLOCKED'))throw Error('No changes made. Resolve blocked accounts or remove them from the reviewed manifest.');
 await volunteers.prisma.$transaction(async tx=>{
  for(const grant of grants){
   const v=await tx.clubVolunteer.findUnique({where:{email:grant.email},include:{acceptances:true}});
   if(!v||v.status!=='ACTIVE'||volunteers.currentAcceptances(v).length)throw Error('Volunteer eligibility changed; no changes committed');
   const before=v.applicationPermissions||[];
   const after=[...new Set([...before,...grant.permissions])];
   if([...before].sort().join('|')===[...after].sort().join('|'))continue;
   await tx.clubVolunteer.update({where:{id:v.id},data:{applicationPermissions:after}});
   await tx.volunteerChange.create({data:{volunteerId:v.id,actor:'reviewed-legacy-permission-import',action:'PERMISSIONS_IMPORTED',details:{before,after}}});
  }
 },{isolationLevel:'Serializable',timeout:60000});
 console.log('Reviewed permission grants imported. No Super Admin permissions were granted.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>volunteers.prisma.$disconnect());
