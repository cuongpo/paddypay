import { snapshot } from '../src/vercel-data.js';
import { answerFarmerQuestion, makeFarmerContext } from '../src/farmer-assist.js';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  let input;
  try{input=typeof req.body==='string'?JSON.parse(req.body):req.body??{};}
  catch{return res.status(400).json({error:'Invalid request body'});}
  if(input.token!==snapshot.receipt.token)return res.status(404).json({error:'Receipt not found'});
  const p=snapshot.plots.find(plot=>plot.code===snapshot.receipt.code);
  const plot={...p,water:snapshot.water[p.cluster],photos:snapshot.photos.filter(photo=>photo.plotCode===p.code)};
  try{
    // The snapshot receipt token is public. Keep this hosted endpoint guide-only.
    const answer=await answerFarmerQuestion({question:input.question,context:makeFarmerContext(snapshot.receipt,plot)});
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json(answer);
  }catch(error){return res.status(400).json({error:error.message});}
}
