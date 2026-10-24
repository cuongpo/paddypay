import test from 'node:test';
import assert from 'node:assert/strict';
import stateHandler from '../api/state.js';
import plotHandler from '../api/plot.js';
import receiptHandler from '../api/receipt.js';
import verifyHandler from '../api/verify.js';
import { snapshot } from '../src/vercel-data.js';

function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.data=data;return this},send(data){this.data=data;return this}}}
test('public snapshot excludes farmer identities from plot APIs',()=>{
  const state=response();stateHandler({method:'GET'},state);
  assert.equal(state.code,200);
  assert.match(state.data.chain,/-snapshot$/);
  assert.equal(state.data.plots.length,24);
  assert.equal(JSON.stringify(state.data).includes('farmerName'),false);
  assert.equal(state.data.actions.length,10);
  assert.equal(state.data.actions.find(action=>action.plotCode==='C-01').canAddEvidence,false);
  const plot=response();plotHandler({method:'GET',query:{code:'A-07'}},plot);
  assert.equal(plot.data.status,'red');
  assert.match(plot.data.reasons.join(' '),/conflicts/);
  const receipt=response();receiptHandler({method:'GET',query:{token:snapshot.receipt.token}},receipt);
  assert.equal(receipt.data.name,'Ms. Ut');
  assert.equal(receipt.data.amount,198975);
});
test('deployed snapshot verifies signature and Merkle proof without local RPC',async()=>{
  const reading=snapshot.verification.reading;
  const req={method:'POST',body:{plotId:reading.plotId,day:reading.day,seq:reading.seq,waterLevelCm:reading.waterLevelCm}};
  const good=response();await verifyHandler(req,good);
  assert.equal(good.data.onchain,true);
  assert.equal(good.data.verificationMode,'signed-local-snapshot');
  const bad=response();await verifyHandler({...req,body:{...req.body,waterLevelCm:reading.waterLevelCm+1}},bad);
  assert.equal(bad.data.onchain,false);
});
