import { readFileSync } from 'node:fs';
export const snapshot=JSON.parse(readFileSync(new URL('../deployment/snapshot.json',import.meta.url),'utf8'));
export const publicPlot=p=>({code:p.code,cluster:p.cluster,areaHa:p.areaHa,status:p.status,reasons:p.reasons,tMilli:p.tMilli,plotId:p.plotId,finalizeTx:p.finalizeTx,saleTx:p.saleTx});
