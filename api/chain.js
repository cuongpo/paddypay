import { snapshot } from '../src/vercel-data.js';
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!snapshot.onchain)return res.status(404).json({error:'No on-chain index in this snapshot'});
  res.setHeader('Cache-Control','public, max-age=300');
  return res.status(200).json(snapshot.onchain);
}
