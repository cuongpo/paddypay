import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFarmerQuestion, guideTopics, groundedFarmerAnswer, makeFarmerContext, validateFarmerQuestion } from '../src/farmer-assist.js';

const receipt = { code:'A-01', season:'Winter–Spring 2026', amount:198975, tMilli:1895, price:150000, farmerBps:7000, withdrawTx:'0xtest' };
const plot = { status:'green', reasons:['Sufficient AWD evidence for the season'], cluster:'A', water:[{day:100,cm:4}], photos:[{day:32},{day:58},{day:83}] };
const context = makeFarmerContext(receipt,plot);

test('guided farmer answers use receipt facts and preserve demo caveats', () => {
  const result = groundedFarmerAnswer(context,['payment','carbon']);
  assert.match(result.answers[0].text,/198,975 dVND/);
  assert.match(result.answers[0].text,/284,250 dVND/);
  assert.match(result.answers[0].text,/not real VND/);
  assert.match(result.answers[1].text,/not been independently verified/);
  assert.equal(result.mode,'guide');
});

test('offline question routing covers evidence and review without inventing a submission', () => {
  assert.deepEqual(guideTopics('What if a water reading is wrong?'),['evidence','review']);
  const result = groundedFarmerAnswer(context,guideTopics('What if a water reading is wrong?'));
  assert.match(result.answers[0].text,/shared cluster/);
  assert.match(result.answers[1].text,/does not send it to a cooperative/);
  assert.throws(()=>validateFarmerQuestion('no'),/between 3 and 300/);
});

test('AI only routes the question; amounts and links come from server context', async () => {
  let sent;
  const fetcher = async (_url, options) => {
    sent = JSON.parse(options.body);
    return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({topics:['payment','review']})}]})};
  };
  const result = await answerFarmerQuestion({question:'My payment looks wrong',context,apiKey:'test-key',fetcher});
  assert.equal(result.mode,'ai');
  assert.deepEqual(result.topics,['payment','review']);
  assert.match(result.answers[0].text,/198,975 dVND/);
  assert.equal(result.answers[1].action.href,'#farmer-review-title');
  assert.equal(sent.output_config.format.type,'json_schema');
  assert.equal(JSON.stringify(sent).includes('198975'),false);
});

test('AI errors fall back visibly to the grounded guide', async () => {
  const result = await answerFarmerQuestion({question:'How much was my share?',context,apiKey:'test-key',fetcher:async()=>{throw Error('offline')}});
  assert.equal(result.mode,'guide');
  assert.match(result.notice,/AI was unavailable/);
  assert.match(result.answers[0].text,/198,975 dVND/);
});
