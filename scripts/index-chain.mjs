import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { indexChain } from '../src/chain-index.js';
import { network } from '../src/networks.js';

// Re-reads the transactions of the last demo run from its chain and stores them in data/demo-state.json.
const statePath=new URL('../data/demo-state.json',import.meta.url);
const state=JSON.parse(await readFile(statePath,'utf8'));
const {chain}=network(state.chain);
const client=createPublicClient({chain,transport:http(state.rpcUrl)});
const artifact=async name=>JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`,import.meta.url))).abi;
state.onchain=await indexChain(client,state,{registryAbi:await artifact('PaddyRegistry'),tokenAbi:await artifact('MockPayToken'),fromBlock:state.firstBlock!=null?BigInt(state.firstBlock):undefined});
await writeFile(statePath,JSON.stringify(state,null,2));
const methods={};for(const t of state.onchain.txs)methods[t.method]=(methods[t.method]??0)+1;
console.log(`Indexed ${state.onchain.txs.length} transactions in blocks ${state.onchain.fromBlock}–${state.onchain.toBlock}; ${Object.keys(state.onchain.anchors).length} anchored roots.`);
console.log(methods);
