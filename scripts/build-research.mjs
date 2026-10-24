import { readFile, writeFile } from 'node:fs/promises';
import { buildResearchSummary } from '../src/research.js';

const source = new URL('../public/research/piezo-2023.csv', import.meta.url);
const target = new URL('../public/research/summary.json', import.meta.url);
const summary = buildResearchSummary(await readFile(source));
await writeFile(target, JSON.stringify(summary, null, 2) + '\n');
console.log(`Research case: ${summary.plots.length} AWD plots, ${summary.measuredRecords}/${summary.totalRecords} measured observations, SHA-256 ${summary.rawSha256}`);
