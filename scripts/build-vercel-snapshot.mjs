import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { normalizeScenario, SEASON } from '../src/core.js';
import { chainView } from '../src/chain-index.js';

const source=normalizeScenario(JSON.parse(await readFile(new URL('../data/demo-state.json',import.meta.url),'utf8')));
const target=new URL('../deployment/snapshot.json',import.meta.url);
let prior;
try { prior=JSON.parse(await readFile(target,'utf8')); } catch {}
const chain=`${source.chain??'anvil'}-snapshot`;
const receiptToken=prior?.receipt?.token ?? randomBytes(32).toString('hex');
const plots=source.plots.map(p=>({code:p.code,cluster:p.cluster,areaHa:p.areaHa,status:p.score.status,reasons:p.score.reasons,tMilli:p.score.status==='green'?p.tMilli:null,plotId:p.plotId,polygonHash:p.polygonHash,qa3:p.qa3,finalizeTx:p.finalizeTx??null,saleTx:p.saleTx??null}));
const water={};
for(const cluster of ['A','B','C']){
  const sample=source.plots.find(p=>p.cluster===cluster);
  water[cluster]=source.readings.filter(r=>r.plotId===sample.plotId&&r.seq%3===1).map(r=>({day:r.day,cm:r.waterLevelCm}));
}
const roots={};
for(const cluster of ['A','B','C']){
  const sample=source.plots.find(p=>p.cluster===cluster);
  roots[cluster]=Object.values(source.daily).filter(b=>b.plotId===sample.plotId).map(b=>({day:b.day,root:b.root}));
}
const photos=source.photos.map(p=>({plotCode:p.plotCode,day:p.day,confirmedCm:p.confirmedCm,source:p.source,imageHash:p.imageHash,ts:p.ts}));
const first=source.plots.find(p=>p.code==='A-01');
const receipt={token:receiptToken,code:first.code,name:first.farmerName,season:SEASON,tMilli:first.tMilli,price:source.price,farmerBps:source.shares.farmer,amount:first.farmerAmount,currency:'simulated dVND',saleTx:first.saleTx,withdrawTx:first.withdrawTx,registryAddress:source.registryAddress,chain};
const verification={reading:source.verification.reading,root:source.daily['A-32'].root,device:source.devices.A};
const snapshot={season:SEASON,chain,explorer:source.explorer??null,registryAddress:source.registryAddress,duplicateHash:source.duplicateHash,duplicateStatus:source.duplicateStatus,price:source.price,shares:source.shares,parameters:source.parameters,plots,water,roots,photos,receipt,verification,onchain:chainView(source)};
await mkdir(new URL('../deployment/',import.meta.url),{recursive:true});
await writeFile(target,JSON.stringify(snapshot,null,2));
console.log(`Wrote safe public snapshot: ${plots.length} plots, ${photos.length} photo hashes, one demo receipt.`);
