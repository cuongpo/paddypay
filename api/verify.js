import { recoverMessageAddress } from 'viem';
import { snapshot } from '../src/vercel-data.js';
import { readingDigest, readingLeaf, hashPair } from '../src/core.js';
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const saved=snapshot.verification.reading;
  const input=req.body??{};
  if(input.plotId!==saved.plotId||Number(input.day)!==saved.day||Number(input.seq)!==saved.seq)return res.status(404).json({error:'Reading not found'});
  const cm=Number.isInteger(input.waterLevelCm)?input.waterLevelCm:saved.waterLevelCm;
  const r={...saved,waterLevelCm:cm};
  let valid=false;
  try{
    const signer=await recoverMessageAddress({message:{raw:readingDigest(r)},signature:r.signature});
    let leaf=readingLeaf(r);
    for(const sibling of r.proof)leaf=hashPair(leaf,sibling);
    valid=signer.toLowerCase()===snapshot.verification.device.toLowerCase()&&leaf===snapshot.verification.root;
  }catch{}
  return res.status(200).json({onchain:valid,verificationMode:'signed-local-snapshot',root:snapshot.verification.root,reading:{day:r.day,seq:r.seq,waterLevelCm:cm,device:r.device,signature:r.signature,proof:r.proof},registryAddress:snapshot.registryAddress});
}
