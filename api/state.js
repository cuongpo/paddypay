import { snapshot, publicPlot } from '../src/vercel-data.js';
import { actionQueue } from '../src/action-queue.js';
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  res.setHeader('Cache-Control','public, max-age=300');
  return res.status(200).json({season:snapshot.season,day:100,chain:snapshot.chain,explorer:snapshot.explorer??null,registryAddress:snapshot.registryAddress,plots:snapshot.plots.map(publicPlot),actions:actionQueue(snapshot.plots,snapshot.photos,snapshot.water,true),price:snapshot.price,shares:snapshot.shares,parameters:snapshot.parameters,duplicateHash:snapshot.duplicateHash,duplicateStatus:snapshot.duplicateStatus,verification:{valid:true,tampered:false},visionAvailable:false,farmerAiAvailable:false,demoReceipt:`#receipt/${snapshot.receipt.token}`});
}
