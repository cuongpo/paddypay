import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, encodeFunctionData, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildScenario, deterministicKey, plotHash, SEASON_ID } from '../src/core.js';
import { Gateway } from '../src/gateway.js';
import { network } from '../src/networks.js';
import { indexChain } from '../src/chain-index.js';

const networkName=process.argv[2]??'anvil';
const {chain,label,explorer}=network(networkName);
const local=networkName==='anvil';
const rpcUrl=local?'http://127.0.0.1:18545':process.env.KAIROS_RPC_URL||chain.rpcUrls.default.http[0];
if(local){
  const anvil=spawn('anvil',['--port','18545','--silent'],{stdio:'ignore'});
  process.on('exit',()=>anvil.kill());
}
process.on('SIGINT',()=>process.exit(0));
process.on('SIGTERM',()=>process.exit(0));
const client=createPublicClient({chain,transport:http(rpcUrl),pollingInterval:local?100:1000});
for (let n=0;n<50;n++) {
  try { await client.getChainId(); break; }
  catch { if(n===49) throw new Error(`Could not reach ${label} at ${rpcUrl}`); await new Promise(r=>setTimeout(r,100)); }
}
// On a public testnet the funded deployer wallet also acts as the cooperative and developer.
if(!local&&!/^0x[0-9a-fA-F]{64}$/.test(process.env.DEPLOYER_PRIVATE_KEY??'')){
  console.error(`Set DEPLOYER_PRIVATE_KEY in .env.local to a funded ${label} wallet.`);
  process.exit(1);
}
const operator=privateKeyToAccount(local?deterministicKey('operator'):process.env.DEPLOYER_PRIVATE_KEY);
const coop=local?privateKeyToAccount(deterministicKey('coop')):operator;
const developer=local?privateKeyToAccount(deterministicKey('developer')):operator;
const wallet=createWalletClient({account:operator,chain,transport:http(rpcUrl)});
const coopWallet=createWalletClient({account:coop,chain,transport:http(rpcUrl)});
async function fund(address,localWei,testnetValue) {
  if(local) return client.request({method:'anvil_setBalance',params:[address,localWei]});
  const hash=await wallet.sendTransaction({to:address,value:parseEther(testnetValue)});
  await client.waitForTransactionReceipt({hash});
}
const startBalance=await client.getBalance({address:operator.address});
const firstBlock=await client.getBlockNumber();
if(local){
  await fund(operator.address,'0x3635c9adc5dea00000');
  await fund(coop.address,'0x56BC75E2D63100000');
}else{
  console.log(`Operator ${operator.address} · ${formatEther(startBalance)} ${chain.nativeCurrency.symbol} on ${label}`);
  if(startBalance<parseEther('2')) throw new Error(`Operator needs at least 2 ${chain.nativeCurrency.symbol} for the full scenario`);
}
const artifact=async name=>JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
const tokenArtifact=await artifact('MockPayToken');
const registryArtifact=await artifact('PaddyRegistry');
async function deployed(abi,bytecode,args=[]) {
  const hash=await wallet.deployContract({abi,bytecode,args});
  const receipt=await client.waitForTransactionReceipt({hash});
  if(receipt.status!=='success') throw new Error('Deployment failed');
  return receipt.contractAddress;
}
async function write(address,abi,functionName,args=[]) {
  const hash=await wallet.writeContract({address,abi,functionName,args});
  const receipt=await client.waitForTransactionReceipt({hash});
  if(receipt.status!=='success') throw new Error(`${functionName} reverted`);
  return hash;
}
console.log(`Building deterministic season and deploying contracts on ${label}…`);
const tokenAddress=await deployed(tokenArtifact.abi,tokenArtifact.bytecode.object);
const registryAddress=await deployed(registryArtifact.abi,registryArtifact.bytecode.object,[tokenAddress,coop.address,developer.address,7000,1000,2000]);
const scenario=await buildScenario();
const gateway=new Gateway(scenario.devices,scenario.plots);
for(const r of scenario.readings) await gateway.accept(r);
for(const [cluster,address] of Object.entries(scenario.devices)) {
  const hash=await coopWallet.writeContract({address:registryAddress,abi:registryArtifact.abi,functionName:'registerDevice',args:[scenario.plots.find(p=>p.cluster===cluster).clusterId,address]});
  await client.waitForTransactionReceipt({hash});
}
for(const p of scenario.plots) await write(registryAddress,registryArtifact.abi,'registerPlot',[p.plotId,SEASON_ID,p.clusterId,p.polygonHash,p.farmer]);
// A second program attempts the same claim. A mined reverted transaction is kept as evidence.
const duplicateData=encodeFunctionData({abi:registryArtifact.abi,functionName:'registerPlot',args:[plotHash('A-07'),SEASON_ID,scenario.plots[0].clusterId,scenario.plots[0].polygonHash,scenario.plots.find(p=>p.code==='A-07').farmer]});
const duplicateHash=await wallet.sendTransaction({to:registryAddress,data:duplicateData,gas:200000n});
const duplicateReceipt=await client.waitForTransactionReceipt({hash:duplicateHash});
if(duplicateReceipt.status!=='reverted') throw new Error('Duplicate claim was not rejected');
const batches=gateway.batches();
for(let i=0;i<batches.length;i+=25) await write(registryAddress,registryArtifact.abi,'anchorBatches',[batches.slice(i,i+25).map(b=>[b.plotId,b.seasonId,b.day,b.root,b.count])]);
const photoInputs=scenario.photos.map(p=>[scenario.plots.find(x=>x.code===p.plotCode).plotId,SEASON_ID,p.evidenceId,p.imageHash]);
for(let i=0;i<photoInputs.length;i+=20) await write(registryAddress,registryArtifact.abi,'recordPhotos',[photoInputs.slice(i,i+20)]);
const green=scenario.plots.filter(p=>p.score.status==='green');
for(const p of green) {
  await write(registryAddress,registryArtifact.abi,'setEligible',[p.plotId,SEASON_ID,true]);
  p.finalizeTx=await write(registryAddress,registryArtifact.abi,'finalizePlot',[p.plotId,SEASON_ID,p.tMilli,p.farmer]);
}
const total=green.reduce((sum,p)=>sum+p.saleAmount,0);
await write(tokenAddress,tokenArtifact.abi,'mint',[operator.address,BigInt(total)]);
await write(tokenAddress,tokenArtifact.abi,'approve',[registryAddress,BigInt(total)]);
for(const p of green) p.saleTx=await write(registryAddress,registryArtifact.abi,'allocateSale',[p.plotId,SEASON_ID,BigInt(p.saleAmount)]);
const first=green.find(p=>p.code==='A-01');
await fund(first.farmer,'0x56BC75E2D63100000','0.05');
const farmerWallet=createWalletClient({account:privateKeyToAccount(deterministicKey('farmer-A-01')),chain,transport:http(rpcUrl)});
first.withdrawTx=await farmerWallet.writeContract({address:registryAddress,abi:registryArtifact.abi,functionName:'withdraw'});
await client.waitForTransactionReceipt({hash:first.withdrawTx});
const check=scenario.readings.find(r=>r.day===32 && r.plotId===first.plotId);
const verified=await client.readContract({address:registryAddress,abi:registryArtifact.abi,functionName:'verifyReading',args:[check.plotId,check.seasonId,check.day,BigInt(check.ts),check.waterLevelCm,BigInt(check.seq),check.device,check.signature,check.proof]});
const tampered=await client.readContract({address:registryAddress,abi:registryArtifact.abi,functionName:'verifyReading',args:[check.plotId,check.seasonId,check.day,BigInt(check.ts),check.waterLevelCm+1,BigInt(check.seq),check.device,check.signature,check.proof]});
if(!verified||tampered) throw new Error('On-chain reading verification failed');
const state={...scenario,chain:networkName,explorer,rpcUrl,firstBlock:Number(firstBlock),registryAddress,tokenAddress,duplicateHash,duplicateStatus:duplicateReceipt.status,verification:{reading:check,valid:verified,tampered},generatedAt:new Date().toISOString()};
state.onchain=await indexChain(client,state,{registryAbi:registryArtifact.abi,tokenAbi:tokenArtifact.abi,fromBlock:firstBlock});
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/demo-state.json',import.meta.url),JSON.stringify(state,null,2));
console.log(`Ready: 24 plots, ${batches.length} anchored batches, ${green.length} finalized plots.`);
console.log(`Duplicate transaction: ${duplicateHash} (${duplicateReceipt.status}). Verification: valid=${verified}, tampered=${tampered}.`);
if(explorer){
  const spent=startBalance-await client.getBalance({address:operator.address});
  console.log(`Registry: ${explorer}/address/${registryAddress} · gas spent ${formatEther(spent)} ${chain.nativeCurrency.symbol}`);
}
await import('../src/server.js');
