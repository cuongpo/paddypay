import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, kairos } from 'viem/chains';

// Kaia Kairos is the default: its faucet needs no login or mainnet balance and gives 50 KAIA per day.
const networks={
  kairos:{chain:kairos,rpcEnv:'KAIROS_RPC_URL',faucet:'https://www.kaia.io/faucet'},
  'base-sepolia':{chain:baseSepolia,rpcEnv:'BASE_SEPOLIA_RPC_URL',faucet:'https://portal.cdp.coinbase.com/products/faucet'},
};
const name=process.argv[2]??'kairos';
const network=networks[name];
if(!network){
  console.error(`Unknown network "${name}". Use one of: ${Object.keys(networks).join(', ')}`);
  process.exit(2);
}
const {chain,faucet}=network;
const key=process.env.DEPLOYER_PRIVATE_KEY;
const coop=process.env.COOP_ADDRESS;
const developer=process.env.DEVELOPER_ADDRESS;
const rpcUrl=process.env[network.rpcEnv]||chain.rpcUrls.default.http[0];
if(!/^0x[0-9a-fA-F]{64}$/.test(key??'')||!/^0x[0-9a-fA-F]{40}$/.test(coop??'')||!/^0x[0-9a-fA-F]{40}$/.test(developer??'')) {
  console.error('Set DEPLOYER_PRIVATE_KEY, COOP_ADDRESS and DEVELOPER_ADDRESS in .env.local.');
  process.exit(1);
}
const account=privateKeyToAccount(key);
const publicClient=createPublicClient({chain,transport:http(rpcUrl)});
const wallet=createWalletClient({account,chain,transport:http(rpcUrl)});
if(await publicClient.getChainId()!==chain.id)throw new Error(`RPC is not ${chain.name}`);
const balance=await publicClient.getBalance({address:account.address});
const symbol=chain.nativeCurrency.symbol;
if(balance===0n){
  console.error(`Deployer ${account.address} has no ${chain.name} ${symbol}. Get test funds at ${faucet}`);
  process.exit(1);
}
console.log(`Deployer ${account.address} · ${formatEther(balance)} ${symbol} on ${chain.name}`);
const artifact=async name=>JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
async function deploy(name,args=[]) {
  const a=await artifact(name);
  const hash=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args});
  const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:2});
  if(receipt.status!=='success')throw new Error(`${name} deployment failed: ${hash}`);
  return {address:receipt.contractAddress,tx:hash};
}
const token=await deploy('MockPayToken');
const registry=await deploy('PaddyRegistry',[token.address,coop,developer,7000,1000,2000]);
const output={chain:name,chainId:chain.id,rpcUrl,token,registry,deployer:account.address,coop,developer,shares:{farmer:7000,coop:1000,developer:2000},deployedAt:new Date().toISOString()};
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL(`../data/${name}-deployment.json`,import.meta.url),JSON.stringify(output,null,2));
const explorer=chain.blockExplorers.default.url;
console.log(`Registry: ${explorer}/address/${registry.address}`);
console.log(`Mock token: ${explorer}/address/${token.address}`);
