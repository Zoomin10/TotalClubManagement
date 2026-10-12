const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=process.env.VOLUNTEER_TEST_ROOT || path.resolve(__dirname,'../TotalClubManagement/backend');
const requireDeps=createRequire(path.join(root,'package.json'));
const express=requireDeps('express');
process.env.TRUDASH_MEMBERSHIP_SHARED_SECRET='test-secret-with-at-least-thirty-two-bytes';
process.env.FRONTEND_URL='https://public.example.com';
process.env.VOLUNTEER_AGREEMENT_VERSION='v1';process.env.VOLUNTEER_AGREEMENT_TEXT='Volunteer terms for tests';
process.env.COACH_CODE_VERSION='v1';process.env.COACH_CODE_TEXT='Coach terms for tests';
let rows=[],accepts=[];
const include=v=>v && {...v,acceptances:accepts.filter(a=>a.volunteerId===v.id)};
const prisma={clubVolunteer:{
 async create({data}) {if(rows.some(v=>v.email===data.email))throw Object.assign(new Error('duplicate'),{code:'P2002'});const {acceptances,...rest}=data;const v={id:'vol1',status:'AWAITING_REVIEW',accessRole:'NONE',notes:'',updatedAt:new Date('2026-10-12T10:00:00Z'),...rest};rows.push(v);for(const a of acceptances.create)accepts.push({id:crypto.randomUUID(),volunteerId:v.id,...a,acceptedAt:new Date()});return include(v);},
 async findUnique({where}){return include(rows.find(v=>where.id?v.id===where.id:v.email===where.email));},
 async findFirst({where}){return include(rows.find(v=>v.acceptanceTokenHash===where.acceptanceTokenHash && v.acceptanceTokenExpiresAt>where.acceptanceTokenExpiresAt.gt));},
 async findMany(){return rows.map(include);},
 async update({where,data}){const v=rows.find(v=>v.id===where.id);Object.assign(v,data,{updatedAt:new Date()});return include(v);},
 async updateMany({where,data}){const v=rows.find(v=>v.id===where.id && v.acceptanceTokenHash===where.acceptanceTokenHash && v.acceptanceTokenExpiresAt>where.acceptanceTokenExpiresAt.gt);if(!v)return {count:0};Object.assign(v,data);return{count:1};}
},volunteerAcceptance:{async upsert({create}){if(!accepts.some(a=>a.volunteerId===create.volunteerId&&a.agreement===create.agreement&&a.version===create.version))accepts.push({id:crypto.randomUUID(),...create,acceptedAt:new Date()});}},volunteerChange:{async create(){}},async $transaction(fn){const oldRows=structuredClone(rows),oldAccepts=structuredClone(accepts);try{return await fn(prisma);}catch(e){rows=oldRows;accepts=oldAccepts;throw e;}}};
function load(file,mocks={}){const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>mocks[n]||(n.startsWith(".") ? createRequire(file)(n) : requireDeps(n)),process,console,Buffer,URL,Map,Date,Set},{filename:file});return module.exports;}
const service=load(path.join(root,'src/services/volunteerService.js'),{'../prisma':prisma});
const auth=load(path.join(root,'src/middleware/trudashAdmin.js'));
const router=load(path.join(root,'src/routes/volunteers.js'),{'../services/volunteerService':service,'../middleware/trudashAdmin':auth});
const app=express();app.use(express.json());app.use('/api/volunteers',router);
const server=app.listen(0);const origin=`http://127.0.0.1:${server.address().port}`;after(()=>server.close());
function assertion(method,url,body,superAdmin=false){const now=Math.floor(Date.now()/1000);const payload={iss:'trudash',aud:'tcm-membership-admin',sub:'admin@wwfc.org.uk',role:'membership_admin',volunteerSuperAdmin:superAdmin,iat:now,exp:now+30,jti:crypto.randomUUID(),method,path:url,bodyHash:crypto.createHash('sha256').update(JSON.stringify(body||null)).digest('hex')};return requireDeps('jsonwebtoken').sign(payload,process.env.TRUDASH_MEMBERSHIP_SHARED_SECRET,{algorithm:'HS256'});}
async function req(method,url,body,signed=false,superAdmin=false){const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',...(signed?{'x-trudash-assertion':assertion(method,url,body,superAdmin)}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
const signup={firstName:'Test',lastName:'Volunteer',email:'TEST@example.com',phone:'07700123456',team:'Magic',requestedRoles:['Events'],acceptances:{VOLUNTEER:'v1'}};
function update(extra={}){return{assignedRoles:['Events'],status:'AWAITING_REVIEW',notes:'',accessRole:'NONE',updatedAt:rows[0].updatedAt.toISOString(),...extra};}
test('public signup cannot self-assign access or appointed roles',async()=>{const r=await req('POST','/api/volunteers/',{...signup,accessRole:'SUPER_ADMIN',assignedRoles:['Trustee']});assert.equal(r.status,201);assert.equal(rows[0].email,'test@example.com');assert.equal(rows[0].accessRole,'NONE');assert.equal(rows[0].assignedRoles.length,0);assert.equal(accepts[0].content,process.env.VOLUNTEER_AGREEMENT_TEXT);});
test('Admin is not a public club role',async()=>{const r=await req('POST','/api/volunteers/',{...signup,requestedRoles:['Admin']});assert.equal(r.status,400);});
test('football applicants must accept Coach Code',async()=>{const r=await req('POST','/api/volunteers/',{...signup,email:'coach@example.com',requestedRoles:['Team Coach']});assert.equal(r.status,400);});
test('unpublished agreements block signup',async()=>{const old=process.env.VOLUNTEER_AGREEMENT_TEXT;delete process.env.VOLUNTEER_AGREEMENT_TEXT;const r=await req('POST','/api/volunteers/',signup);process.env.VOLUNTEER_AGREEMENT_TEXT=old;assert.equal(r.status,503);});
test('anonymous callers cannot list volunteers',async()=>{assert.equal((await req('GET','/api/volunteers/admin')).status,401);});
test('signed administrator can list without revealing token hashes',async()=>{rows[0].acceptanceTokenHash='secret';const r=await req('GET','/api/volunteers/admin',null,true);assert.equal(r.status,200);assert.equal(r.data.volunteers[0].acceptanceTokenHash,undefined);});
test('ordinary administrator cannot grant Super Admin',async()=>{assert.equal((await req('PATCH','/api/volunteers/admin/vol1',update({accessRole:'SUPER_ADMIN'}),true)).status,403);});
test('missing Coach acceptance blocks activation atomically',async()=>{const r=await req('PATCH','/api/volunteers/admin/vol1',update({assignedRoles:['Team Coach'],status:'ACTIVE'}),true);assert.equal(r.status,409);assert.equal(rows[0].status,'AWAITING_REVIEW');assert.equal(rows[0].assignedRoles.length,0);});
test('stale profile update is rejected',async()=>{const r=await req('PATCH','/api/volunteers/admin/vol1',update({updatedAt:'2020-01-01T00:00:00.000Z'}),true);assert.equal(r.status,409);});
test('bootstrap Super Admin may assign access after accepted activation',async()=>{const r=await req('PATCH','/api/volunteers/admin/vol1',update({accessRole:'ADMIN',status:'ACTIVE'}),true,true);assert.equal(r.status,200);assert.equal(r.data.accessRole,'ADMIN');});
test('acceptance token is single-use and keeps saved agreement snapshot',async()=>{const r=await req('POST','/api/volunteers/admin/vol1/acceptance-link',{},true);assert.equal(r.status,200);const token=new URL(r.data.url).pathname.split('/').at(-1);assert.equal((await req('GET',`/api/volunteers/accept/${token}`)).status,200);assert.equal((await req('POST',`/api/volunteers/accept/${token}`,{acceptances:{VOLUNTEER:'v1'}})).status,200);assert.equal((await req('POST',`/api/volunteers/accept/${token}`,{acceptances:{VOLUNTEER:'v1'}})).status,404);});
test('signed assertion does not permit tampered request bodies',async()=>{const url='/api/volunteers/admin/vol1';const body=update();const r=await fetch(origin+url,{method:'PATCH',headers:{'Content-Type':'application/json','x-trudash-assertion':assertion('PATCH',url,body)},body:JSON.stringify({...body,accessRole:'SUPER_ADMIN'})});assert.equal(r.status,401);});
test('volunteer proxy whitelist permits intended actions only',()=>{
 const bridgePath=process.env.VOLUNTEER_BRIDGE_PATH || path.resolve(__dirname,'../TruDash/routes/membershipPilot.js');
 const bridge=load(bridgePath);
 assert.equal(bridge.permittedPath('GET','/volunteers'),true);
 assert.equal(bridge.permittedPath('PATCH','/volunteers/vol1'),true);
 assert.equal(bridge.permittedPath('POST','/volunteers/vol1/acceptance-link'),true);
 assert.equal(bridge.permittedPath('DELETE','/volunteers/vol1'),false);
 assert.equal(bridge.permittedPath('PATCH','/volunteers/../members'),false);
 const request={session:{user:{username:'admin@wwfc.org.uk'}},method:'PATCH',body:{accessRole:'SUPER_ADMIN'}};
 const regular=requireDeps('jsonwebtoken').verify(bridge.signAssertion(process.env.TRUDASH_MEMBERSHIP_SHARED_SECRET,request,'/api/volunteers/admin/vol1'),process.env.TRUDASH_MEMBERSHIP_SHARED_SECRET);
 assert.equal(regular.volunteerSuperAdmin,false);
});

test('published documents default to exact v1.0 terms and downloadable originals',()=>{
 const keys=['VOLUNTEER_AGREEMENT_VERSION','VOLUNTEER_AGREEMENT_TEXT','COACH_CODE_VERSION','COACH_CODE_TEXT'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];
 try {const docs=service.agreements();assert.equal(docs.length,2);for(const doc of docs){assert.equal(doc.version,'1.0');assert.ok(doc.content.includes('Version 1.0'));assert.ok(doc.acknowledgement.startsWith('I confirm'));assert.ok(doc.downloadPath.endsWith('-v1.0.docx'));assert.ok(doc.content.length>4000);}}
 finally {for(const k of keys)process.env[k]=saved[k];}
});
