// On-chain inspector and transaction feed that follow the digital twin's day and selection.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (h, a = 6, b = 4) => h ? `${h.slice(0, a)}…${h.slice(-b)}` : '—';
const fmt = n => new Intl.NumberFormat('en-US').format(n);
const gas = n => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
const seasonTime = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const blockTime = ts => new Date(ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const METHOD_KIND = { anchorBatches: 'anchor', recordPhotos: 'photo', registerPlot: 'setup', registerDevice: 'setup', deploy: 'setup', setEligible: 'final', finalizePlot: 'final', mint: 'money', approve: 'money', allocateSale: 'money', transfer: 'money', withdraw: 'money' };

export function chainPanels({ inspector, feed, chain, plots, statusText }) {
  const link = (path, h, text) => h && chain.explorer ? `<a href="${chain.explorer}/${path}/${h}" target="_blank" rel="noopener">${text ?? short(h)} ↗</a>` : esc(text ?? short(h));
  const txByHash = new Map(chain.txs.map(t => [t.hash, t]));
  const network = chain.explorer ? 'Kaia Kairos' : 'Local chain';
  let day = 100, cluster = 'A', plot = null, shownFeed = -1;

  function merkleSvg(n) {
    const levels = [n]; while (levels.at(-1) > 1) levels.push(Math.ceil(levels.at(-1) / 2));
    const W = 220, H = 22 + (levels.length - 1) * 30, pos = levels.map((count, li) => Array.from({ length: count }, (_, i) => [W * (i + 0.5) / count, H - 11 - li * 30]));
    let lines = '', dots = '';
    pos.forEach((row, li) => row.forEach(([x, y], i) => {
      if (li > 0) for (const c of [2 * i, 2 * i + 1]) if (pos[li - 1][c]) lines += `<line x1="${x}" y1="${y}" x2="${pos[li - 1][c][0]}" y2="${pos[li - 1][c][1]}"/>`;
      const root = li === levels.length - 1, leaf = li === 0;
      dots += `<rect x="${x - (root ? 22 : 13)}" y="${y - 8}" width="${root ? 44 : 26}" height="16" rx="5" class="${root ? 'root' : leaf ? 'leaf' : 'node'}"/><text x="${x}" y="${y + 4}">${root ? 'root' : leaf ? `r${i + 1}` : 'h'}</text>`;
    }));
    return `<svg class="ci-tree" viewBox="0 0 ${W} ${H}" role="img" aria-label="Merkle tree of ${n} readings">${lines}${dots}</svg>`;
  }

  function plotCard() {
    const p = plots.find(x => x.code === plot); if (!p) return '';
    const txs = chain.txs.filter(t => t.plot === plot);
    const photos = chain.photos.filter(x => x.plot === plot);
    const row = (label, t) => t ? `<div class="ci-life ${t.status !== 'success' ? 'bad' : ''}"><span>${label}</span><span>${t.day <= day ? link('tx', t.hash) : '<em>later in season</em>'}</span></div>` : '';
    const reg = txs.find(t => t.method === 'registerPlot' && t.status === 'success'), dup = txs.find(t => t.method === 'registerPlot' && t.status !== 'success');
    const fin = txs.find(t => t.method === 'finalizePlot'), sale = txs.find(t => t.method === 'allocateSale'), wd = txs.find(t => t.method === 'withdraw');
    const photoTx = photos.filter(x => x.day <= day);
    return `<div class="ci-plot"><div class="ci-plot-head"><b>Plot ${esc(p.code)}</b><span class="status ${p.status}">${statusText[p.status]}</span><button class="ci-x" aria-label="Clear plot">×</button></div>
      ${row('Registered', reg)}${row('Duplicate claim (reverted)', dup)}
      <div class="ci-life"><span>Photo hashes on-chain</span><span>${photoTx.length ? `${photoTx.length} · ${link('tx', photoTx.at(-1).tx)}` : '—'}</span></div>
      ${row(`Finalized${p.tMilli ? ` · ${(p.tMilli / 1000).toFixed(3)} tCO₂e` : ''}`, fin)}${row('Sale split 70/10/20', sale)}${row('Farmer withdrawal', wd)}
      <a class="ci-open" href="#plot/${esc(p.code)}">Open full evidence →</a></div>`;
  }

  function renderInspector() {
    const entry = chain.days[cluster]?.find(d => d.day === day);
    const tx = entry?.tx ? txByHash.get(entry.tx) : null;
    const device = chain.devices[cluster];
    const readings = entry ? entry.readings.map(([seq, ts, cm, sig]) => `<div class="ci-reading"><span>${seasonTime(ts)}</span><b>${cm} cm</b><code title="${esc(sig)}">${short(sig, 8, 4)}</code><i title="Signature recovers to the registered device">✓</i></div>`).join('') : '';
    inspector.innerHTML = `<div class="ci-head"><div><div class="eyebrow">On-chain data</div><div class="ci-title">Day ${day} · Cluster ${cluster}</div></div><div class="ci-tabs">${['A', 'B', 'C'].map(c => `<button data-cluster="${c}" class="${c === cluster ? 'on' : ''}">${c}</button>`).join('')}</div></div>
      ${plotCard()}
      <ol class="ci-steps">
        <li class="ci-step"><div class="ci-num">1</div><div class="ci-body"><h4>Signed sensor readings</h4><p class="ci-sub">Device ${link('address', device, short(device))} · EIP-191 signature per reading</p>${entry ? readings : '<p class="ci-empty">No readings received — sensor offline.</p>'}</div></li>
        <li class="ci-step"><div class="ci-num">2</div><div class="ci-body"><h4>Merkle root of the day</h4>${entry ? `${merkleSvg(entry.count)}<code class="ci-hash">${entry.root}</code>` : '<p class="ci-empty">Nothing to hash.</p>'}</div></li>
        <li class="ci-step"><div class="ci-num">3</div><div class="ci-body"><h4>Anchored on ${network}</h4>${tx ? `<div class="ci-tx"><span class="ci-method anchor">anchorBatches()</span><span>Block <b>#${fmt(tx.block)}</b></span><span>${gas(tx.gasUsed)} gas · ${tx.events.BatchAnchored ?? 0} roots in this tx</span><span>${blockTime(tx.time)}</span></div><code class="ci-event">BatchAnchored(day: ${day}, root: ${short(entry.root, 8, 6)}, count: ${entry.count})</code><div class="ci-link">${link('tx', tx.hash, `Tx ${short(tx.hash, 10, 6)}`)}</div>` : entry ? '<p class="ci-empty">Root saved locally; no indexed transaction.</p>' : '<p class="ci-empty">No root anchored for this day — the plots need extra evidence before they can be finalized.</p>'}</div></li>
      </ol>`;
    inspector.querySelectorAll('[data-cluster]').forEach(b => b.onclick = () => { cluster = b.dataset.cluster; renderInspector(); });
    inspector.querySelector('.ci-x')?.addEventListener('click', () => { plot = null; renderInspector(); });
  }

  function renderFeed() {
    const visible = chain.txs.filter(t => t.day <= day);
    if (visible.length === shownFeed) return;
    const fresh = visible.length > shownFeed && shownFeed >= 0 ? new Set(visible.slice(shownFeed).map(t => t.hash)) : new Set();
    shownFeed = visible.length;
    const rows = visible.slice().reverse().map(t => `<tr class="${fresh.has(t.hash) ? 'fresh' : ''} ${t.status !== 'success' ? 'reverted' : ''}"><td class="mono">#${fmt(t.block)}</td><td><span class="ci-method ${METHOD_KIND[t.method] ?? ''}">${esc(t.method)}</span></td><td>${esc(t.summary)}${t.status !== 'success' ? ' <b class="ci-rev">reverted</b>' : ''}</td><td class="mono">${gas(t.gasUsed)}</td><td class="mono">${link('tx', t.hash)}</td></tr>`).join('');
    feed.innerHTML = `<div class="panelhead"><h2>On-chain activity · ${network}</h2><small><b>${visible.length}</b> / ${chain.txs.length} transactions · ${link('address', chain.registry, 'registry contract')}</small></div>
      <div class="feed-scroll"><table class="data-table feed-table"><thead><tr><th>Block</th><th>Method</th><th>What happened</th><th>Gas</th><th>Transaction</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="small">No transactions yet.</td></tr>'}</tbody></table></div>`;
  }

  renderInspector(); renderFeed();
  return {
    setDay(d) { if (d === day) return; day = d; renderInspector(); renderFeed(); },
    select({ plot: code, cluster: c, day: d }) { if (code !== undefined) plot = code; if (c) cluster = c; if (d) day = d; renderInspector(); renderFeed(); inspector.classList.remove('pulse'); void inspector.offsetWidth; inspector.classList.add('pulse'); },
  };
}
