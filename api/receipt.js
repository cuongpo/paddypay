import { snapshot } from '../src/vercel-data.js';
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(req.query.token!==snapshot.receipt.token)return res.status(404).json({error:'Receipt not found'});
  res.setHeader('Cache-Control','private, no-store');
  return res.status(200).json(Object.fromEntries(Object.entries(snapshot.receipt).filter(([key])=>key!=='token')));
}
