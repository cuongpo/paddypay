import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPhotoReading, reviewPhotoWithAI, validatePhotoInput } from '../src/ai-review.js';
import { actionQueue } from '../src/action-queue.js';

const readable = {
  waterTubeVisible: true, waterlineVisible: true, suggestedCm: -12,
  confidence: 'high', qualityIssues: [], explanation: 'The waterline and reference marks are visible.',
};

test('AI photo screening separates matching, conflicting and missing sensor evidence', () => {
  const match = assessPhotoReading(readable, -12);
  assert.equal(match.recommendation, 'human_confirmation');
  assert.equal(match.comparison.deltaCm, 0);
  const conflict = assessPhotoReading(readable, 4);
  assert.equal(conflict.recommendation, 'needs_review');
  assert.match(conflict.reasons.join(' '), /16 cm/);
  const outage = assessPhotoReading(readable, null);
  assert.equal(outage.recommendation, 'needs_review');
  assert.match(outage.reasons.join(' '), /No signed cluster reading/);
});

test('AI abstains when reference is absent or photo is unreadable', () => {
  const missingScale = assessPhotoReading({ ...readable, qualityIssues: ['no_zero_reference'] }, -12);
  assert.equal(missingScale.ai.suggestedCm, null);
  assert.equal(missingScale.recommendation, 'unreadable');
  const blurred = assessPhotoReading({ ...readable, waterlineVisible: false, confidence: 'low', qualityIssues: ['blur'] }, -12);
  assert.equal(blurred.recommendation, 'unreadable');
  assert.throws(() => assessPhotoReading({ ...readable, confidence: 'certain' }, -12), /invalid assessment/);
});

test('AI request uses image input and schema; result binds to image hash', async () => {
  const input = { mediaType: 'image/png', base64: Buffer.from('sample-image').toString('base64') };
  let request;
  const fetcher = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(readable) }] }) };
  };
  const result = await reviewPhotoWithAI({ input, sensorCm: 4, apiKey: 'test-key', fetcher });
  assert.equal(request.messages[0].content[0].source.data, input.base64);
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.equal(result.imageHash, validatePhotoInput(input).imageHash);
  assert.equal(result.recommendation, 'needs_review');
  assert.equal(result.ai.suggestedCm, -12);
  assert.equal(result.requiresConfirmation, true);
});

test('an AI exception stays in the cooperative action queue after a human records the photo', () => {
  const plot = { code: 'T-01', cluster: 'T', score: { status: 'green', reasons: [] } };
  const review = { ...assessPhotoReading(readable, 4), imageHash: '0xabc' };
  const photo = { plotCode: plot.code, day: 32, confirmedCm: -12, imageHash: '0xabc', aiReview: review };
  const actions = actionQueue([plot], [photo], { T: [{ day: 32, cm: 4 }] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'ai-photo-review');
  assert.equal(actions[0].state, 'open');
  assert.equal(actions[0].canAddEvidence, false);
});
