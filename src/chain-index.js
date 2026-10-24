import { decodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';

const plotKey = (plotId, seasonId) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [plotId, seasonId]));
const fmt = n => new Intl.NumberFormat('en-US').format(n);

// Reads the registry and token logs for a demo run and records every transaction, so the UI can show real hashes and blocks.
export async function indexChain(client, state, { registryAbi, tokenAbi, fromBlock }) {
  const dup = await client.getTransactionReceipt({ hash: state.duplicateHash });
  const first = state.plots.find(p => p.withdrawTx);
  const last = first ? await client.getTransactionReceipt({ hash: first.withdrawTx }) : dup;
  const from = fromBlock ?? (dup.blockNumber > 300n ? dup.blockNumber - 300n : 0n);
  const to = last.blockNumber;
  const [registryLogs, tokenLogs] = await Promise.all([
    client.getContractEvents({ address: state.registryAddress, abi: registryAbi, fromBlock: from, toBlock: to }),
    client.getContractEvents({ address: state.tokenAddress, abi: tokenAbi, fromBlock: from, toBlock: to }),
  ]);
  const byKey = new Map(state.plots.map(p => [plotKey(p.plotId, p.seasonId ?? state.seasonId), p]));
  const anchors = {}, photoTx = {};
  const hashes = new Set([state.duplicateHash]);
  for (const log of [...registryLogs, ...tokenLogs]) {
    hashes.add(log.transactionHash);
    if (log.eventName === 'BatchAnchored') {
      const p = byKey.get(log.args.plotKey);
      if (p) anchors[`${p.cluster}-${log.args.day}`] = log.transactionHash;
    }
    if (log.eventName === 'PhotoRecorded') photoTx[log.args.evidenceId] = log.transactionHash;
  }
  // Some calls emit no event (setEligible, token mint/approve, gas top-ups, deployments), so scan the blocks too.
  const contracts = new Set([state.registryAddress, state.tokenAddress].map(a => a.toLowerCase()));
  const actors = new Set();
  const found = new Map();
  for (let n = from; n <= to; n += 20n) {
    const batch = await Promise.all(Array.from({ length: Number(to - n + 1n < 20n ? to - n + 1n : 20n) }, (_, i) => client.getBlock({ blockNumber: n + BigInt(i), includeTransactions: true })));
    for (const block of batch) for (const tx of block.transactions) found.set(tx.hash, { tx, block });
  }
  for (const { tx } of found.values()) if (hashes.has(tx.hash) || contracts.has(tx.to?.toLowerCase())) actors.add(tx.from.toLowerCase());
  const txs = [];
  for (const [hash, { tx, block }] of found) {
    const related = hashes.has(hash) || contracts.has(tx.to?.toLowerCase()) || actors.has(tx.from.toLowerCase());
    if (!related) continue;
    const receipt = await client.getTransactionReceipt({ hash });
    if (!tx.to && !contracts.has(receipt.contractAddress?.toLowerCase())) continue;
    const isToken = tx.to?.toLowerCase() === state.tokenAddress.toLowerCase();
    let call = null;
    if (!tx.to) call = { functionName: 'deploy', args: [receipt.contractAddress] };
    else if (tx.input === '0x') call = { functionName: 'transfer', args: [tx.to, tx.value] };
    else try { call = decodeFunctionData({ abi: isToken ? tokenAbi : registryAbi, data: tx.input }); } catch {}
    const events = {};
    for (const log of [...registryLogs, ...tokenLogs]) if (log.transactionHash === hash) events[log.eventName] = (events[log.eventName] ?? 0) + 1;
    txs.push({
      hash, block: Number(block.number), time: Number(block.timestamp), from: tx.from,
      to: !tx.to ? 'new contract' : isToken ? 'token' : contracts.has(tx.to.toLowerCase()) ? 'registry' : tx.to, method: call?.functionName ?? 'unknown', status: receipt.status,
      gasUsed: Number(receipt.gasUsed), events, ...describe(state, call, receipt, events),
    });
  }
  txs.sort((a, b) => a.block - b.block || a.hash.localeCompare(b.hash));
  return { fromBlock: Number(from), toBlock: Number(to), anchors, photoTx, txs };
}

function describe(state, call, receipt, events) {
  const plot = id => state.plots.find(p => p.plotId === id);
  const a = call?.args ?? [];
  switch (call?.functionName) {
    case 'deploy': return { day: 0, summary: `${a[0]?.toLowerCase() === state.registryAddress.toLowerCase() ? 'PaddyRegistry' : 'Simulated dVND token'} contract deployed` };
    case 'transfer': return { day: 95, plot: state.plots.find(p => p.farmer.toLowerCase() === a[0].toLowerCase())?.code, summary: `Gas top-up for farmer ${state.plots.find(p => p.farmer.toLowerCase() === a[0].toLowerCase())?.code ?? ''} wallet`.trim() };
    case 'registerDevice': return { day: 0, summary: `Sensor device registered for cluster ${state.plots.find(p => p.clusterId === a[0])?.cluster ?? '?'}` };
    case 'registerPlot':
      if (receipt.status !== 'success') return { day: 25, plot: plot(a[0])?.code, summary: `Second program tried to register ${plot(a[0])?.code ?? 'a plot'} again — rejected` };
      return { day: 0, plot: plot(a[0])?.code, summary: `Plot ${plot(a[0])?.code} registered for the season` };
    case 'anchorBatches': {
      const days = a[0].map(b => b.day);
      // Shown from the first day it covers, so every lit ledger cell already has its transaction in the feed.
      return { day: Math.min(...days), summary: `${a[0].length} daily Merkle roots · days ${Math.min(...days)}–${Math.max(...days)}` };
    }
    case 'recordPhotos': {
      const days = a[0].map(p => state.photos.find(x => x.evidenceId === p.evidenceId)?.day ?? 0);
      return { day: Math.max(...days), summary: `${a[0].length} water-tube photo hashes` };
    }
    case 'setEligible': return { day: 83, plot: plot(a[0])?.code, summary: `${plot(a[0])?.code} marked AWD-eligible` };
    case 'finalizePlot': return { day: 83, plot: plot(a[0])?.code, summary: `${plot(a[0])?.code} finalized · ${(Number(a[2]) / 1000).toFixed(3)} tCO₂e` };
    case 'mint': return { day: 90, summary: `Buyer funds ${fmt(Number(a[1]))} simulated dVND` };
    case 'approve': return { day: 90, summary: 'Registry approved to distribute the sale' };
    case 'allocateSale': return { day: 90, plot: plot(a[0])?.code, summary: `${plot(a[0])?.code} sale ${fmt(Number(a[2]))} dVND split 70/10/20` };
    case 'withdraw': return { day: 95, plot: state.plots.find(p => p.withdrawTx === receipt.transactionHash)?.code, summary: `Farmer withdraws ${fmt(state.plots.find(p => p.withdrawTx)?.farmerAmount ?? 0)} dVND` };
    default: return { day: 0, summary: Object.keys(events).join(', ') || 'Transaction' };
  }
}

// Public view for the UI: signed readings, roots and the transaction that anchored each root.
export function chainView(state) {
  const onchain = state.onchain ?? { anchors: {}, txs: [] };
  const days = {};
  for (const b of Object.values(state.daily)) {
    const cluster = state.plots.find(p => p.plotId === b.plotId).cluster;
    (days[cluster] ??= []).push({ day: b.day, root: b.root, count: b.count, tx: onchain.anchors[`${cluster}-${b.day}`] ?? null, readings: b.readings.map(r => [r.seq, r.ts, r.waterLevelCm, r.signature]) });
  }
  for (const list of Object.values(days)) list.sort((a, b) => a.day - b.day);
  const photos = state.photos.map(p => ({ plot: p.plotCode, day: p.day, imageHash: p.imageHash, tx: onchain.photoTx?.[p.evidenceId] ?? p.tx ?? null }));
  // Wallet addresses stay out of the public view; the transaction hash is enough to inspect it on the explorer.
  const txs = onchain.txs.map(({ from, to, ...t }) => ({ ...t, to: ['registry', 'token', 'new contract'].includes(to) ? to : 'wallet' }));
  return { explorer: state.explorer ?? null, registry: state.registryAddress, token: state.tokenAddress, devices: state.devices, days, photos, txs };
}
