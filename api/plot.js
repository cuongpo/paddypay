import { snapshot, publicPlot } from '../src/vercel-data.js';
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const p=snapshot.plots.find(x=>x.code===req.query.code);
  if(!p)return res.status(404).json({error:'Plot not found'});
  const sample=snapshot.plots.find(x=>x.cluster===p.cluster);
  res.setHeader('Cache-Control','public, max-age=300');
  return res.status(200).json({...publicPlot(p),water:snapshot.water[p.cluster],photos:snapshot.photos.filter(x=>x.plotCode===p.code),roots:snapshot.roots[p.cluster],qa3:p.qa3,samplePlot:sample.code});
}
