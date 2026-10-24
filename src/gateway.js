import { recoverMessageAddress } from 'viem';
import { readingDigest, merkle } from './core.js';

export class Gateway {
  constructor(devicesByCluster, plots) {
    this.devicesByCluster = devicesByCluster;
    this.plotById = new Map(plots.map(p=>[p.plotId,p]));
    this.lastSeq = new Map();
    this.readings = [];
    this.pending = new Map();
  }
  async accept(r) {
    const plot = this.plotById.get(r.plotId);
    if (!plot || plot.seasonId !== r.seasonId || this.devicesByCluster[plot.cluster]?.toLowerCase() !== r.device.toLowerCase()) throw new Error('Unregistered device or plot');
    const signer = await recoverMessageAddress({message:{raw:readingDigest(r)},signature:r.signature});
    if (signer.toLowerCase() !== r.device.toLowerCase()) throw new Error('Invalid device signature');
    if (r.seq <= (this.lastSeq.get(r.device) ?? 0)) throw new Error('Repeated or out-of-order sequence');
    this.lastSeq.set(r.device,r.seq);
    this.readings.push(r);
    const key=`${r.plotId}-${r.day}`;
    if (!this.pending.has(key)) this.pending.set(key,[]);
    this.pending.get(key).push(r);
  }
  batches() {
    return [...this.pending.values()].map(group=>({plotId:group[0].plotId,seasonId:group[0].seasonId,day:group[0].day,root:merkle(group).root,count:group.length}));
  }
}
