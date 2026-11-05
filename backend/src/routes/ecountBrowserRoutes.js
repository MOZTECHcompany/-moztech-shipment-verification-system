const express = require('express');
const { createEcountBrowserService } = require('../services/ecountBrowserService');
function createEcountBrowserRouter({ pool, env = process.env }) {
    const router=express.Router(),service=createEcountBrowserService({pool,env});
    const handle=work=>async(req,res)=>{
        res.set('Cache-Control','private, no-store');
        if(!req.user?.id)return res.status(401).json({code:'AUTH_REQUIRED',message:'需要認證'});
        try{res.json(await work(req));}catch(error){const status=Number.isInteger(error.status)?error.status:500;
            res.status(status).json({code:error.code||'ECOUNT_BROWSER_FAILED',message:status===500?'ECOUNT 助手處理失敗，請重新載入核對':error.message});}
    };
    router.get('/status',handle(req=>service.status(req.user,req.query.orderId===undefined?undefined:Number(req.query.orderId))));
    router.post('/reconcile',handle(req=>service.reconcile(req.body,req.user)));
    router.post('/claim',handle(req=>service.claim(req.body,req.user)));
    router.post('/jobs/:jobId/prepare',handle(req=>service.prepare(req.params.jobId,req.body,req.user)));
    router.post('/jobs/:jobId/result',handle(req=>service.result(req.params.jobId,req.body,req.user)));
    router.post('/jobs/:jobId/recover',handle(req=>service.recover(req.params.jobId,req.body,req.user)));
    router.post('/jobs/:jobId/retry',handle(req=>service.retry(req.params.jobId,req.body,req.user)));
    return router;
}
module.exports={createEcountBrowserRouter};
