import { createHash } from 'node:crypto';
import { encodeAbiParameters, encodePacked, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const SEASON = 'Winter–Spring 2026';
// Keep the existing on-chain ID so saved signatures and proofs remain valid.
export const SEASON_ID = '0xbca67bebd45ad8fbc72cfe42154746312ad6352ee7f169bcf5ff5fe11d8ccb4b';
const farmerNameFor = code => code === 'A-01' ? 'Ms. Ut' : `Farmer household ${code}`;
export const PRICE = 150000; // assumed demo VND per tCO2e
export const SHARES = { farmer: 7000, coop: 1000, developer: 2000 };
export const PARAMETERS = { ef: 1.22, baselineWater: 1, awdWater: 0.55, singleDryWater: 0.71, preseason: 1, days: 100, gwp: 28, uncertainty: 0.15 };

export function qa3(areaHa, p = PARAMETERS) {
  const baselineKg = p.ef * p.baselineWater * p.preseason * p.days;
  const projectKg = p.ef * p.awdWater * p.preseason * p.days;
  const grossPerHa = (baselineKg - projectKg) / 1000 * p.gwp;
  return { baselineKg, projectKg, grossPerHa, netPerHa: grossPerHa * (1 - p.uncertainty), tonnes: grossPerHa * (1 - p.uncertainty) * areaHa };
}
export function deterministicKey(label) {
  if (!process.env.SIM_SEED) throw new Error('SIM_SEED is required for simulated keys');
  return `0x${createHash('sha256').update(`paddypay-demo-${process.env.SIM_SEED}-${label}`).digest('hex')}`;
}
export function plotHash(code) { return keccak256(stringToHex(code.trim().toUpperCase())); }
export function clusterHash(code) { return keccak256(stringToHex(code)); }
export function readingDigest(r) {
  return keccak256(encodeAbiParameters(
    [{type:'address'}, {type:'bytes32'}, {type:'bytes32'}, {type:'uint64'}, {type:'int32'}, {type:'uint64'}],
    [r.device, r.plotId, r.seasonId, BigInt(r.ts), r.waterLevelCm, BigInt(r.seq)]
  ));
}
export function readingLeaf(r) { return keccak256(encodePacked(['bytes32', 'bytes'], [readingDigest(r), r.signature])); }
export function hashPair(a, b) { return a.toLowerCase() < b.toLowerCase() ? keccak256(encodePacked(['bytes32','bytes32'], [a,b])) : keccak256(encodePacked(['bytes32','bytes32'], [b,a])); }
export function merkle(readings) {
  let level = readings.map(readingLeaf);
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashPair(level[i], level[i+1] ?? level[i]));
    level = next;
    layers.push(level);
  }
  return { root: level[0], proof(index) {
    const out = [];
    for (let depth = 0; depth < layers.length - 1; depth++) {
      out.push(layers[depth][index ^ 1] ?? layers[depth][index]);
      index = Math.floor(index / 2);
    }
    return out;
  }};
}
export function waterAt(day) {
  if ((day >= 30 && day <= 38) || (day >= 54 && day <= 62) || (day >= 80 && day <= 88)) return -12;
  return 4;
}
export function scorePlot(plot, clusterReadings, photos, thresholds = {}) {
  const t = { firstDry:21, minDryCm:10, maxDryCm:15, minDryEvents:2, flowerStart:65, flowerEnd:75, maxGapDays:2, photoToleranceCm:10, ...thresholds };
  const red = [], yellow = [];
  const byDay = new Map(clusterReadings.map(r => [r.day, r.waterLevelCm]));
  let gap = 0, maxGap = 0, dryStarts = [], inDry = false;
  for (let day = 1; day <= 100; day++) {
    const level = byDay.get(day);
    if (level === undefined) { maxGap = Math.max(maxGap, ++gap); continue; }
    gap = 0;
    if (level <= -t.minDryCm && !inDry) dryStarts.push(day);
    inDry = level <= -t.minDryCm;
    if (day >= t.flowerStart && day <= t.flowerEnd && level < 0) red.push('Field was not flooded during flowering');
    if (level < -t.maxDryCm) red.push('Water level fell below the safety threshold');
  }
  if (dryStarts.length && dryStarts[0] < t.firstDry) red.push('Field was drained too early');
  if (dryStarts.length < t.minDryEvents) red.push('Fewer than two drainage events');
  if (maxGap > t.maxGapDays) yellow.push(`Sensor data missing for ${maxGap} days`);
  for (const required of [32, 58, 83]) if (!photos.some(p => p.day === required)) yellow.push(`Missing photo for day ${required}`);
  for (const p of photos) {
    const measured = byDay.get(p.day);
    if (p.confirmedCm < -t.maxDryCm) red.push(`Day ${p.day} photo: water level too low`);
    if (measured !== undefined && Math.abs(p.confirmedCm - measured) > t.photoToleranceCm) red.push(`Day ${p.day} photo conflicts with the cluster sensor`);
  }
  const reasons = [...new Set([...red, ...yellow])];
  return { status:red.length ? 'red' : yellow.length ? 'yellow' : 'green', reasons:reasons.length ? reasons : ['Sufficient AWD evidence for the season'], dryStarts, maxGap };
}
export async function buildScenario() {
  const clusters = ['A','B','C'];
  const devices = Object.fromEntries(clusters.map(c => [c, privateKeyToAccount(deterministicKey(`sensor-${c}`))]));
  const plots = [];
  for (const cluster of clusters) for (let n=1; n<=8; n++) {
    const code = `${cluster}-${String(n).padStart(2,'0')}`;
    plots.push({ code, plotId:plotHash(code), seasonId:SEASON_ID, cluster, clusterId:clusterHash(cluster), areaHa:code==='A-01'?1.45:1 + (n%4)*0.1, farmerName:farmerNameFor(code), farmer:privateKeyToAccount(deterministicKey(`farmer-${code}`)).address, polygonHash:keccak256(stringToHex(`simulated-polygon-${code}`)) });
  }
  const readings = [], daily = {};
  for (const cluster of clusters) {
    const account = devices[cluster], plot = plots.find(p=>p.cluster===cluster);
    let seq = 0;
    for (let day=1; day<=100; day++) {
      if (cluster==='C' && day>=47 && day<=50) continue;
      const group=[];
      for (let sample=0; sample<3; sample++) {
        const r={device:account.address,plotId:plot.plotId,seasonId:SEASON_ID,day,ts:1767225600+(day-1)*86400+sample*3600,waterLevelCm:waterAt(day),seq:++seq};
        r.signature=await account.signMessage({message:{raw:readingDigest(r)}});
        group.push(r);readings.push(r);
      }
      const tree=merkle(group);
      group.forEach((r,i)=>r.proof=tree.proof(i));
      daily[`${cluster}-${day}`]={root:tree.root,count:group.length,plotId:plot.plotId,day,readings:group};
    }
  }
  const photos=[];
  for (const plot of plots) {
    for (const day of [32,58,83]) {
      if (plot.code==='C-01' && day===83) continue; // Recovery task: a required photo is missing.
      const confirmedCm=plot.code==='B-06'&&day===32?-18:waterAt(day);
      photos.push({plotCode:plot.code,day,confirmedCm,ts:1767225600+(day-1)*86400+43200,source:'simulated',imageHash:keccak256(stringToHex(`simulated-photo-${plot.code}-${day}`)),evidenceId:keccak256(stringToHex(`${plot.code}-${day}`))});
    }
    if (plot.code==='A-07') photos.push({plotCode:plot.code,day:25,confirmedCm:-12,ts:1767225600+24*86400+43200,source:'simulated',imageHash:keccak256(stringToHex('simulated-photo-A-07-25')),evidenceId:keccak256(stringToHex('A-07-25'))});
  }
  for (const plot of plots) {
    const clusterData=readings.filter(r=>r.plotId===plots.find(p=>p.cluster===plot.cluster).plotId && r.seq%3===1).map(r=>({day:r.day,waterLevelCm:r.waterLevelCm}));
    plot.score=scorePlot(plot,clusterData,photos.filter(p=>p.plotCode===plot.code));
    plot.qa3=qa3(plot.areaHa);
    plot.tMilli=Math.round(plot.qa3.tonnes*1000);
    plot.saleAmount=Math.round(plot.tMilli*PRICE/1000);
    plot.farmerAmount=Math.floor(plot.saleAmount*SHARES.farmer/10000);
  }
  return {season:SEASON,seasonId:SEASON_ID,plots,devices:Object.fromEntries(clusters.map(c=>[c,devices[c].address])),readings,daily,photos,price:PRICE,shares:SHARES,parameters:PARAMETERS};
}
export function normalizeScenario(state) {
  state.season = SEASON;
  const samples = new Map();
  for (const plot of state.plots) if (!samples.has(plot.cluster)) samples.set(plot.cluster, plot);
  for (const plot of state.plots) {
    const sample = samples.get(plot.cluster);
    const readings = state.readings.filter(r => r.plotId === sample.plotId && r.seq % 3 === 1).map(r => ({day:r.day,waterLevelCm:r.waterLevelCm}));
    plot.score = scorePlot(plot, readings, state.photos.filter(p => p.plotCode === plot.code));
    plot.farmerName = farmerNameFor(plot.code);
  }
  return state;
}
