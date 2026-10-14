const express = require('express');
const {verifyTrudashAdmin} = require('../middleware/trudashAdmin');
const {applicationAccess} = require('../services/applicationPermissions');
const router=express.Router();
router.get('/me', async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(!req.get('x-trudash-assertion'))return res.status(401).json({error:'Microsoft sign-in through TruDash required'});
 if(!verifyTrudashAdmin(req,res))return;
 try{res.json(await applicationAccess(req.trudashAdmin));}
 catch{res.status(503).json({error:'Application permissions could not be checked'});}
});
module.exports=router;
