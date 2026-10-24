import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildResearchSummary } from '../src/research.js';

test('published AWD case keeps source provenance and blocks payout claims', async () => {
  const raw = await readFile(new URL('../public/research/piezo-2023.csv', import.meta.url));
  const generated = buildResearchSummary(raw);
  const committed = JSON.parse(await readFile(new URL('../public/research/summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(generated, committed);
  assert.equal(generated.rawSha256, '6738932f96c2133d023db08b2118b46aac02ea69073dcd008c4040c51e8514c0');
  assert.equal(generated.totalRecords, 345);
  assert.equal(generated.measuredRecords, 344);
  assert.deepEqual(generated.plots.map(p => p.code), ['P01', 'P05', 'P09', 'P10', 'P14']);
  assert.equal(generated.plots.find(p => p.code === 'P14').missing, 1);
  assert.ok(generated.plots.every(p => p.maxObservedIntervalDays === 39));
  assert.equal(generated.eligibility.status, 'insufficient-evidence');
  assert.equal('tCO2e' in generated, false);
  assert.equal('payout' in generated, false);
});
