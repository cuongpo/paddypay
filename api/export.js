import { snapshot } from '../src/vercel-data.js';
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const rows=snapshot.plots.map(p=>[p.code,snapshot.season,p.cluster,p.areaHa,p.status,p.tMilli?(p.tMilli/1000).toFixed(3):'',snapshot.photos.find(x=>x.plotCode===p.code)?.imageHash??'',p.polygonHash].join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="paddypay-plots.csv"');
  return res.status(200).send('\ufeffplot_code,season,cluster,area_ha,status,tco2e_estimate,evidence_hash,polygon_hash\n'+rows.join('\n'));
}
