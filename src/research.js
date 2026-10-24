import { createHash } from 'node:crypto';

// A separate research case study. These observations do not belong to the
// simulated An Giang season and must never enter its eligibility or payout path.
export const RESEARCH_SOURCE = {
  title: 'Impact of climate change mitigation strategies in rice farming on agroecosystem multifunctionality',
  authors: 'Echeverría-Progulakis et al.',
  place: 'Catalonia, Spain',
  year: 2023,
  paper: 'https://doi.org/10.1111/1365-2664.70303',
  repository: 'https://github.com/echeverriaseba/Thesis_Paper_3',
  file: 'https://github.com/echeverriaseba/Thesis_Paper_3/blob/7af258ac87b937d85a3b4b81c166736e9cbd3377/data/2023/Piezo_2023.csv',
  license: 'CC0-1.0',
};

export function buildResearchSummary(bytes) {
  const csv = Buffer.from(bytes).toString('latin1');
  const rows = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    // The first seven columns are plain CSV fields; later free-text notes may
    // contain commas, but are not used in this analysis.
    const [date, plot, , treatment, , , rawLevel] = line.split(',');
    if (!/^2023-\d{2}-\d{2}$/.test(date ?? '') || !/^P\d{2}$/.test(plot ?? '') || treatment !== 'AWD') continue;
    const level = rawLevel?.trim() === '' ? null : Number(rawLevel);
    rows.push({ date, plot, cm: Number.isFinite(level) ? level : null });
  }
  const plots = [...new Set(rows.map(row => row.plot))].sort().map(code => {
    const all = rows.filter(row => row.plot === code).sort((a, b) => a.date.localeCompare(b.date));
    const readings = all.filter(row => row.cm !== null).map(({ date, cm }) => ({ date, cm }));
    const observedDates = [...new Set(readings.map(row => row.date))];
    const intervals = observedDates.slice(1).map((date, i) => (Date.parse(date) - Date.parse(observedDates[i])) / 86400000);
    return {
      code,
      recorded: all.length,
      measured: readings.length,
      missing: all.length - readings.length,
      observedDates: observedDates.length,
      maxObservedIntervalDays: Math.max(0, ...intervals),
      minCm: Math.min(...readings.map(row => row.cm)),
      maxCm: Math.max(...readings.map(row => row.cm)),
      readings,
    };
  });
  const dates = rows.map(row => row.date).sort();
  const longestInterval = Math.max(0, ...plots.map(plot => plot.maxObservedIntervalDays));
  return {
    source: RESEARCH_SOURCE,
    rawFile: '/research/piezo-2023.csv',
    rawSha256: createHash('sha256').update(bytes).digest('hex'),
    scope: 'Independent published field measurements; not collected by PaddyPay',
    firstDate: dates[0],
    lastDate: dates.at(-1),
    totalRecords: rows.length,
    measuredRecords: rows.filter(row => row.cm !== null).length,
    plots,
    eligibility: {
      status: 'insufficient-evidence',
      reasons: [
        'No PaddyPay device signatures or on-chain Merkle roots for these measurements',
        'No matching water-tube photo files or independent plot verification in this dataset',
        `Observation intervals reach ${longestInterval} days; the PaddyPay simulated-season rule requires much denser evidence`,
        'The research calendar and location differ from the simulated 100-day An Giang season',
      ],
      note: 'Water-level observations can test ingestion and visualization. They cannot establish carbon credits or farmer payouts.',
    },
  };
}
