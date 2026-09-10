// Local UI fixture only. Never bind externally or run as the production application.
const express=require('express'),path=require('path'),{PGlite}=require('@electric-sql/pglite'),{readFileSync}=require('fs');
const {createLogisticsRouter}=require('../src/routes/logisticsRoutes');
(async()=>{const db=new PGlite();await db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT);CREATE TABLE orders(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1,'admin');INSERT INTO orders VALUES(1);");await db.exec(readFileSync(path.join(__dirname,'../migrations/020_ecpay_tracking.sql'),'utf8'));
const account={id:'test-a',label:'物流測試帳號',merchantId:'2000132',environment:'stage',hashKey:'5294y06JbISpM5x9',hashIv:'v77hoKGq4kWxNNIS',services:['UNIMART','FAMI','HILIFE'],enabled:true,verified:true};
const env={WMS_ECPAY_ACCOUNTS_JSON:JSON.stringify([account,{id:'test-b',label:'第二帳號（尚未設定）',merchantId:'2000933',environment:'stage',services:[],enabled:false,verified:false}])};
const app=express();app.use(express.json());
app.post('/api/auth/login',(req,res)=>{if(req.body.username!=='preview'||req.body.password!=='preview')return res.sendStatus(401);res.json({accessToken:'local-preview-only',user:{id:1,username:'preview',name:'介面測試',role:'admin'}});});
app.use((req,res,next)=>{if(req.headers.authorization==='Bearer local-preview-only')req.user={id:1};next();});
app.use('/api/logistics',createLogisticsRouter({pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})},env,query:async(a,q)=>({accountId:a.id,merchantId:a.merchantId,environment:a.environment,logisticsId:q.logisticsId||'123',merchantTradeNo:q.merchantTradeNo||'TEST20260910',shipmentNo:'76500000000',service:'UNIMART',status:'uncollected',statusCode:'2074',statusLabel:'逾期未取',checkedAt:new Date().toISOString(),needsReturnTracking:true})}));
app.use('/api',(req,res)=>res.json({items:[],tasks:[],total:0}));app.use('/socket.io',(req,res)=>res.sendStatus(404));
const dist=path.join(__dirname,'../../frontend/dist');app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));
const server=app.listen(5196,'127.0.0.1',()=>console.log('Local fixture ready http://127.0.0.1:5196/login'));
process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));})();
