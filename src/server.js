import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deterministicKey, merkle, normalizeScenario, scorePlot, SEASON, SEASON_ID } from './core.js';
import { network } from './networks.js';
import { chainView } from './chain-index.js';
import { actionQueue, sampleWaterByCluster } from './action-queue.js';
import { DEFAULT_AI_MODEL, reviewPhotoWithAI } from './ai-review.js';
import { answerFarmerQuestion, makeFarmerContext } from './farmer-assist.js';

const statePath=new URL('../data/demo-state.json',import.meta.url);
let state;
try { state=normalizeScenario(JSON.parse(await readFile(statePath,'utf8'))); }
catch { console.error('No demo state. Run ./run.sh demo first.'); process.exit(1); }
const registryAbi=JSON.parse(await readFile(new URL('../contracts/out/PaddyRegistry.sol/PaddyRegistry.json',import.meta.url))).abi;
const {chain}=network(state.chain);
const operatorKey=state.chain==='anvil'?deterministicKey('operator'):process.env.DEPLOYER_PRIVATE_KEY;
const publicClient=createPublicClient({chain,transport:http(state.rpcUrl)});
const wallet=createWalletClient({account:privateKeyToAccount(operatorKey),chain,transport:http(state.rpcUrl)});
const waterByCluster=sampleWaterByCluster(state);
const pendingPhotoReviews=new Map();
const tokenFor=code=>createHash('sha256').update(`paddypay-demo-receipt-${code}-${process.env.SIM_SEED}`).digest('hex');
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const send=(res,status,type,body)=>{res.writeHead(status,{'content-type':type});res.end(body);};
const body=async req=>{let s='';for await(const chunk of req){s+=chunk;if(s.length>8_000_000)throw Error('Upload too large');}return JSON.parse(s);};
function publicPlot(p){return {code:p.code,cluster:p.cluster,areaHa:p.areaHa,status:p.score.status,reasons:p.score.reasons,tMilli:p.score.status==='green'?p.tMilli:null,plotId:p.plotId,finalizeTx:p.finalizeTx??null,saleTx:p.saleTx??null};}
async function route(req,res){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/state') return json(res,200,{season:SEASON,day:100,chain:state.chain,explorer:state.explorer??null,registryAddress:state.registryAddress,plots:state.plots.map(publicPlot),actions:actionQueue(state.plots,state.photos,waterByCluster),price:state.price,shares:state.shares,parameters:state.parameters,duplicateHash:state.duplicateHash,duplicateStatus:state.duplicateStatus,verification:{valid:state.verification.valid,tampered:state.verification.tampered},visionAvailable:Boolean(process.env.ANTHROPIC_API_KEY),farmerAiAvailable:Boolean(process.env.ANTHROPIC_API_KEY),demoReceipt:`#receipt/${tokenFor('A-01')}`});
  if(url.pathname==='/api/chain') return json(res,200,chainView(state));
  if(url.pathname.startsWith('/api/plot/')){
    const code=decodeURIComponent(url.pathname.slice(10));const p=state.plots.find(x=>x.code===code);
    if(!p)return json(res,404,{error:'Plot not found'});
    const samplePlot=state.plots.find(x=>x.cluster===p.cluster);
    const water=state.readings.filter(r=>r.plotId===samplePlot.plotId&&r.seq%3===1).map(r=>({day:r.day,cm:r.waterLevelCm}));
    const photos=state.photos.filter(x=>x.plotCode===code).map(({day,confirmedCm,source,imageHash,ts,tx,aiReview})=>({day,confirmedCm,source,imageHash,ts,tx:tx??null,aiReview:aiReview??null}));
    const roots=Object.values(state.daily).filter(x=>x.plotId===samplePlot.plotId).map(x=>({day:x.day,root:x.root}));
    return json(res,200,{...publicPlot(p),water,photos,roots,qa3:p.qa3,samplePlot:samplePlot.code});
  }
  if(url.pathname.startsWith('/api/receipt/')){
    const token=url.pathname.slice(13);
    const p=state.plots.find(x=>tokenFor(x.code)===token&&x.saleTx);
    if(!p)return json(res,404,{error:'Receipt not found'});
    return json(res,200,{code:p.code,name:p.farmerName,season:SEASON,tMilli:p.tMilli,price:state.price,farmerBps:state.shares.farmer,amount:p.farmerAmount,currency:'simulated dVND',saleTx:p.saleTx,withdrawTx:p.withdrawTx??null,registryAddress:state.registryAddress,chain:state.chain,explorer:state.explorer??null});
  }
  if(url.pathname==='/api/farmer-assist'&&req.method==='POST'){
    const input=await body(req);
    const p=state.plots.find(x=>tokenFor(x.code)===input.token&&x.saleTx);
    if(!p)return json(res,404,{error:'Receipt not found'});
    const receipt={code:p.code,season:SEASON,tMilli:p.tMilli,price:state.price,farmerBps:state.shares.farmer,amount:p.farmerAmount,withdrawTx:p.withdrawTx??null};
    const plot={...publicPlot(p),water:waterByCluster[p.cluster],photos:state.photos.filter(photo=>photo.plotCode===p.code)};
    try{
      const answer=await answerFarmerQuestion({question:input.question,context:makeFarmerContext(receipt,plot),apiKey:process.env.ANTHROPIC_API_KEY,model:process.env.ANTHROPIC_MODEL||DEFAULT_AI_MODEL});
      return json(res,200,answer);
    }catch(error){return json(res,400,{error:error.message});}
  }
  if(url.pathname==='/api/verify'&&req.method==='POST'){
    const input=await body(req);const r=state.readings.find(x=>x.plotId===input.plotId&&x.day===input.day&&x.seq===input.seq);
    if(!r)return json(res,404,{error:'Reading not found'});
    const cm=Number.isInteger(input.waterLevelCm)?input.waterLevelCm:r.waterLevelCm;
    const args=[r.plotId,r.seasonId,r.day,BigInt(r.ts),cm,BigInt(r.seq),r.device,r.signature,r.proof];
    try {
      const onchain=await publicClient.readContract({address:state.registryAddress,abi:registryAbi,functionName:'verifyReading',args});
      const batch=state.daily[`${state.plots.find(p=>p.plotId===r.plotId).cluster}-${r.day}`];
      return json(res,200,{onchain,root:batch.root,reading:{day:r.day,seq:r.seq,waterLevelCm:cm,device:r.device,signature:r.signature,proof:r.proof},registryAddress:state.registryAddress});
    }catch(e){return json(res,503,{error:'Chain unavailable',detail:e.shortMessage??e.message});}
  }
  if(url.pathname==='/api/read-photo'&&req.method==='POST'){
    if(!process.env.ANTHROPIC_API_KEY)return json(res,503,{error:'No vision API key; enter the reading manually'});
    const input=await body(req);
    const p=state.plots.find(x=>x.code===input.plotCode);
    if(!p||!Number.isInteger(input.day)||input.day<1||input.day>100)return json(res,400,{error:'Invalid plot or day'});
    if(p.finalizeTx)return json(res,409,{error:'Plot already finalized; evidence is locked'});
    try{
      const sensorCm=waterByCluster[p.cluster]?.find(reading=>reading.day===input.day)?.cm??null;
      const review=await reviewPhotoWithAI({input,sensorCm,apiKey:process.env.ANTHROPIC_API_KEY,model:process.env.ANTHROPIC_MODEL||DEFAULT_AI_MODEL});
      const record={...review,plotCode:p.code,day:input.day,reviewedAt:new Date().toISOString()};
      pendingPhotoReviews.set(`${p.code}:${input.day}:${review.imageHash}`,record);
      if(pendingPhotoReviews.size>100)pendingPhotoReviews.delete(pendingPhotoReviews.keys().next().value);
      return json(res,200,record);
    }catch(error){
      const invalid=/^(Unsupported image|Image must be)/.test(error.message);
      return json(res,invalid?400:502,{error:invalid?error.message:'AI review unavailable',detail:invalid?undefined:error.message});
    }
  }
  if(url.pathname==='/api/photo'&&req.method==='POST'){
    const input=await body(req);const p=state.plots.find(x=>x.code===input.plotCode);
    if(!p||!Number.isInteger(input.day)||input.day<1||input.day>100||!Number.isInteger(input.confirmedCm))return json(res,400,{error:'Invalid plot, day or water level'});
    if(input.humanConfirmed!==true)return json(res,400,{error:'Confirm the measured water level before recording'});
    if(p.finalizeTx)return json(res,409,{error:'Plot already finalized; evidence is locked'});
    const bytes=Buffer.from(String(input.base64??''),'base64');
    if(bytes.length<1||bytes.length>5_000_000)return json(res,400,{error:'Image must be 1 byte to 5 MB'});
    const imageHash=keccak256(bytes);
    const reviewKey=`${p.code}:${input.day}:${imageHash}`;
    const aiReview=pendingPhotoReviews.get(reviewKey)??null;
    const evidenceId=keccak256(toBytes(`${p.code}-${input.day}-${Date.now()}`));
    await mkdir(new URL('../data/photos/',import.meta.url),{recursive:true});
    await writeFile(new URL(`../data/photos/${imageHash.slice(2)}.bin`,import.meta.url),bytes);
    const hash=await wallet.writeContract({address:state.registryAddress,abi:registryAbi,functionName:'recordPhoto',args:[p.plotId,SEASON_ID,evidenceId,imageHash]});
    await publicClient.waitForTransactionReceipt({hash});
    state.photos.push({plotCode:p.code,day:input.day,confirmedCm:input.confirmedCm,ts:Math.floor(Date.now()/1000),source:'user-confirmed',imageHash,evidenceId,tx:hash,coords:input.coords??null,aiReview:aiReview?{...aiReview,humanConfirmedCm:input.confirmedCm}:null});
    pendingPhotoReviews.delete(reviewKey);
    const samplePlot=state.plots.find(x=>x.cluster===p.cluster);
    const clusterReadings=state.readings.filter(r=>r.plotId===samplePlot.plotId&&r.seq%3===1).map(r=>({day:r.day,waterLevelCm:r.waterLevelCm}));
    p.score=scorePlot(p,clusterReadings,state.photos.filter(x=>x.plotCode===p.code));
    await writeFile(statePath,JSON.stringify(state,null,2));
    return json(res,200,{imageHash,tx:hash,status:p.score.status,reasons:p.score.reasons});
  }
  if(url.pathname==='/api/export.csv'){
    const header='plot_code,season,cluster,area_ha,status,tco2e_estimate,evidence_hash,polygon_hash\n';
    const rows=state.plots.map(p=>[p.code,SEASON,p.cluster,p.areaHa,p.score.status,p.score.status==='green'?p.qa3.tonnes.toFixed(3):'',state.photos.find(x=>x.plotCode===p.code)?.imageHash??'',p.polygonHash].join(','));
    return send(res,200,'text/csv; charset=utf-8','\ufeff'+header+rows.join('\n'));
  }
  const staticPaths={'/':'index.html','/index.html':'index.html','/judges.html':'judges.html','/farmer.html':'farmer.html','/style.css':'style.css','/app.js':'app.js','/farmer.js':'farmer.js','/twin.js':'twin.js','/chain-panels.js':'chain-panels.js','/research/summary.json':'research/summary.json','/research/piezo-2023.csv':'research/piezo-2023.csv'};
  const file=staticPaths[url.pathname];if(!file)return send(res,404,'text/plain','Not found');
  const types={'index.html':'text/html; charset=utf-8','judges.html':'text/html; charset=utf-8','farmer.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','app.js':'text/javascript; charset=utf-8','farmer.js':'text/javascript; charset=utf-8','twin.js':'text/javascript; charset=utf-8','chain-panels.js':'text/javascript; charset=utf-8','research/summary.json':'application/json; charset=utf-8','research/piezo-2023.csv':'text/csv; charset=iso-8859-1'};
  return send(res,200,types[file],await readFile(new URL(`../public/${file}`,import.meta.url)));
}
const port=Number(process.env.PORT||4174);
createServer((req,res)=>route(req,res).catch(e=>json(res,500,{error:e.message}))).listen(port,()=>console.log(`PaddyPay demo: http://localhost:${port}`));
