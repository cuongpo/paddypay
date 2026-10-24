const app = document.querySelector('#farmer-app');
const fmt = value => new Intl.NumberFormat('en-US').format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const categoryNames = {water:'Water-level reading',area:'Plot area',payment:'Farmer payment',other:'Something else'};

function draftText(draft) {
  return `REVIEW REQUEST · PADDYPAY DEMO\nPlot: ${draft.plotCode}\nSeason: ${draft.season}\nIssue: ${categoryNames[draft.category]}\nDetails: ${draft.details}\nCreated: ${draft.createdAt}\nSale transaction: ${draft.saleTx ?? 'None'}\n\nThis request was created in the demo. The cooperative has not received or acknowledged it.`;
}

async function start() {
  try {
    const stateResponse = await fetch('/api/state');
    if (!stateResponse.ok) throw new Error('Could not load the demo.');
    const state = await stateResponse.json();
    const demoToken = state.demoReceipt?.split('/').at(-1);
    const token = decodeURIComponent(location.hash.slice(1)) || demoToken;
    if (!token) throw new Error('Receipt access code is missing.');
    const receiptResponse = await fetch(`/api/receipt/${encodeURIComponent(token)}`);
    if (!receiptResponse.ok) throw new Error('No receipt was found for this code.');
    const receipt = await receiptResponse.json();
    const plotResponse = await fetch(`/api/plot/${encodeURIComponent(receipt.code)}`);
    if (!plotResponse.ok) throw new Error('Could not load the plot.');
    const plot = await plotResponse.json();
    render(state, receipt, plot, token);
  } catch (error) {
    app.innerHTML = `<div class="callout"><strong>Could not open the farmer view.</strong> ${esc(error.message)} <a class="inline-link" href="/">Back to the dashboard</a></div>`;
  }
}

function render(state, receipt, plot, token) {
  const green = plot.status === 'green';
  const lastReading = plot.water.at(-1);
  const saleTotal = Math.round(receipt.tMilli * receipt.price / 1000);
  const photoCount = plot.photos.length;
  const draftKey = `paddypay-farmer-draft:${token}`;
  const txUrl = state.explorer && receipt.saleTx ? `${state.explorer}/tx/${receipt.saleTx}` : null;
  const withdrawUrl = state.explorer && receipt.withdrawTx ? `${state.explorer}/tx/${receipt.withdrawTx}` : null;
  const statusLabel = green ? 'Evidence complete in demo' : plot.status === 'yellow' ? 'More evidence needed' : 'Needs review';
  const task = plot.finalizeTx
    ? 'The demo season is finalized. Review the evidence and simulated allocation below.'
    : 'This plot is awaiting an evidence review. Contact the cooperative to check the original measurements and photos.';
  app.innerHTML = `
    <section class="farmer-intro" aria-labelledby="farmer-title">
      <div class="farmer-eyebrow"><span class="farmer-eyebrow-dot"></span> YOUR FARMER VIEW <span class="farmer-eyebrow-separator">/</span> SIMULATED SEASON</div>
      <div class="farmer-intro-row"><div><h1 id="farmer-title">${esc(receipt.code === 'A-01' ? 'Hello, Ms. Ut.' : 'Hello.')}</h1><p>Here is the latest summary for your plot.</p></div><div class="farmer-plot-tag"><span>PLOT</span><strong>${esc(plot.code)}</strong></div></div>
    </section>
    <div class="farmer-disclosure" role="note"><span class="farmer-disclosure-icon" aria-hidden="true">i</span><span><strong>Demo data</strong> · The farmer identity, measurements, photos, sale proceeds, and dVND are simulated. No real money or carbon credits were issued.</span></div>
    <div class="farmer-dashboard">
      <section class="farmer-balance" aria-labelledby="farmer-balance-title">
        <div class="farmer-balance-top"><span class="farmer-section-label" id="farmer-balance-title">YOUR SIMULATED ALLOCATION</span><span class="farmer-balance-icon" aria-hidden="true">↗</span></div>
        <div class="farmer-amount">${fmt(receipt.amount)} <span>dVND</span></div>
        <p class="farmer-balance-caption">Your ${receipt.farmerBps / 100}% share of the simulated carbon sale</p>
        <div class="farmer-balance-bottom"><span class="farmer-balance-state"><span class="farmer-state-dot"></span>${receipt.withdrawTx ? 'Demo tokens withdrawn' : 'No withdrawal transaction'}</span><span>${esc(receipt.season)} season</span></div>
      </section>
      <section class="farmer-status-card" aria-labelledby="farmer-status-title">
        <div class="farmer-card-kicker">PLOT STATUS</div>
        <h2 id="farmer-status-title">${esc(statusLabel)}</h2>
        <p>${task}</p>
        <div class="farmer-status-meta"><div><span>Plot</span><strong>${esc(plot.code)}</strong></div><div><span>Area</span><strong>${esc(plot.areaHa)} ha</strong></div><div><span>Season</span><strong>${esc(receipt.season)}</strong></div></div>
      </section>
    </div>
    <section class="farmer-assist" aria-labelledby="farmer-assist-title">
      <div class="farmer-assist-intro"><span class="farmer-assist-symbol" aria-hidden="true">✦</span><div><div class="farmer-card-kicker">YOUR PLOT, EXPLAINED</div><h2 id="farmer-assist-title">Have a question?</h2><p>Ask about your evidence, simulated share, or how to request a review.</p></div><span class="farmer-assist-mode">${state.farmerAiAvailable ? 'AI ASSISTED' : 'GUIDED ANSWERS'}</span></div>
      <div class="farmer-assist-prompts" aria-label="Suggested questions"><button type="button" data-question="How was my share calculated?">My payment</button><button type="button" data-question="Why is my plot eligible?">Plot status</button><button type="button" data-question="What if a water reading is wrong?">Report an issue</button></div>
      <form id="farmer-assist-form" class="farmer-assist-form"><label class="sr-only" for="farmer-question">Ask about your plot</label><input id="farmer-question" name="question" type="text" maxlength="300" minlength="3" placeholder="Ask about your plot…" required><button type="submit">Ask <span aria-hidden="true">→</span></button></form>
      <div id="farmer-assist-answer" class="farmer-assist-answer" aria-live="polite"></div>
      <p class="farmer-assist-footnote">Answers use this simulated record. They cannot verify a field visit, issue credits, or send a review request.</p>
    </section>
    <div class="farmer-detail-grid">
      <section class="farmer-evidence-card" aria-labelledby="farmer-evidence-title">
        <div class="farmer-card-kicker">THE RECORD BEHIND THIS SUMMARY</div><h2 id="farmer-evidence-title">Plot evidence</h2>
        <div class="farmer-evidence-row"><div class="farmer-evidence-symbol" aria-hidden="true">↧</div><div><span>Latest cluster ${esc(plot.cluster)} reading</span><strong>Day ${esc(lastReading?.day ?? '—')} · ${esc(lastReading?.cm ?? '—')} cm</strong></div></div>
        <div class="farmer-evidence-row"><div class="farmer-evidence-symbol" aria-hidden="true">▧</div><div><span>Demo photo records</span><strong>${photoCount} simulated hash${photoCount === 1 ? '' : 'es'}</strong></div></div>
        <p class="farmer-note">The sensor is shared across the irrigation cluster, so this is not a plot-specific reading. Photo hashes are simulated, not field image files.</p>
        <a class="farmer-text-link" href="/#plot/${encodeURIComponent(plot.code)}">Inspect plot evidence <span aria-hidden="true">↗</span></a>
      </section>
      <section class="farmer-breakdown-card" aria-labelledby="farmer-breakdown-title">
        <div class="farmer-card-kicker">HOW THE DEMO CALCULATES IT</div><h2 id="farmer-breakdown-title">Allocation details</h2>
        <div class="farmer-steps"><div><span>Plot estimate</span><strong>${(receipt.tMilli / 1000).toFixed(3)} tCO₂e</strong></div><div><span>Assumed price</span><strong>${fmt(receipt.price)} dVND/tCO₂e</strong></div><div><span>Simulated sale proceeds</span><strong>${fmt(saleTotal)} dVND</strong></div><div class="farmer-steps-total"><span>Farmer allocation · ${receipt.farmerBps / 100}%</span><strong>${fmt(receipt.amount)} dVND</strong></div></div>
        <p class="farmer-note">This amount uses a simplified methane estimate and has not been independently verified.</p>
        <div class="farmer-chain-links">${txUrl ? `<a class="farmer-text-link" href="${esc(txUrl)}" target="_blank" rel="noopener">View allocation on KaiaScan <span aria-hidden="true">↗</span></a>` : '<span class="farmer-note">No public explorer link is available.</span>'}${withdrawUrl ? `<a class="farmer-text-link" href="${esc(withdrawUrl)}" target="_blank" rel="noopener">View withdrawal transaction <span aria-hidden="true">↗</span></a>` : ''}</div>
      </section>
    </div>
    <section class="farmer-review" aria-labelledby="farmer-review-title"><div class="farmer-review-heading"><div><div class="farmer-card-kicker">NEED A CORRECTION?</div><h2 id="farmer-review-title">Something looks wrong?</h2><p>Save a request you can share with your cooperative.</p></div><span aria-hidden="true" class="farmer-review-illustration">✳</span></div><details class="farmer-review-details"><summary>Create a review request <span aria-hidden="true">＋</span></summary><div class="farmer-review-content"><p>Your draft stays on this device until you download or share it. The cooperative does not receive it automatically.</p><form id="farmer-review-form" class="farmer-form"><label>What needs review?<select name="category" required><option value="water">Water-level reading</option><option value="area">Plot area</option><option value="payment">Farmer payment</option><option value="other">Something else</option></select></label><label>Tell us what looks wrong<textarea name="details" rows="4" maxlength="500" minlength="10" required placeholder="For example: The day 32 reading for plot A-01 may be incorrect…"></textarea></label><button class="btn" type="submit">Save request on this device</button></form></div></details><div id="farmer-draft"></div></section>`;

  const assistForm = document.querySelector('#farmer-assist-form');
  const assistAnswer = document.querySelector('#farmer-assist-answer');
  let assistRequest = 0;
  const ask = async question => {
    const id = ++assistRequest;
    assistAnswer.innerHTML = '<div class="farmer-assist-wait">Finding the relevant part of this record…</div>';
    try {
      const response = await fetch('/api/farmer-assist', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,question})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not answer this question.');
      if (id !== assistRequest) return;
      const safeLink = action => action && (/^#[a-z-]+$/.test(action.href) || /^\/#plot\/[A-Za-z0-9-]+$/.test(action.href));
      assistAnswer.innerHTML = `<div class="farmer-assist-result"><div class="farmer-assist-result-label">${result.mode === 'ai' ? 'AI MATCHED TO YOUR RECORD' : 'GUIDED ANSWER'} · SIMULATED DATA</div>${result.notice ? `<p class="farmer-assist-notice">${esc(result.notice)}</p>` : ''}${(result.answers || []).map(answer => `<div class="farmer-assist-response"><p>${esc(answer.text)}</p>${safeLink(answer.action) ? `<a href="${esc(answer.action.href)}">${esc(answer.action.label)} <span aria-hidden="true">↗</span></a>` : ''}</div>`).join('')}</div>`;
      assistAnswer.querySelector('a[href="#farmer-review-title"]')?.addEventListener('click',() => {document.querySelector('.farmer-review-details').open = true;});
    } catch (error) {
      if (id === assistRequest) assistAnswer.innerHTML = `<div class="farmer-assist-error">${esc(error.message)}</div>`;
    }
  };
  assistForm.onsubmit = event => {event.preventDefault();const question=assistForm.elements.question.value.trim();if(question.length>=3)ask(question);};
  document.querySelectorAll('.farmer-assist-prompts button').forEach(button => button.onclick = () => {const question=button.dataset.question;assistForm.elements.question.value=question;ask(question);});

  const form = document.querySelector('#farmer-review-form');
  const draftBox = document.querySelector('#farmer-draft');
  let draft;
  try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { draft = null; }
  const showDraft = () => {
    if (!draft) { draftBox.innerHTML = ''; return; }
    draftBox.innerHTML = `<div class="farmer-draft"><strong>Saved on this device · not sent to the cooperative</strong><p>${esc(categoryNames[draft.category])}: ${esc(draft.details)}</p><small>${esc(draft.createdAt)}</small><div class="farmer-draft-actions"><button class="btn secondary" id="farmer-download" type="button">Download request</button><button class="btn ghost" id="farmer-share" type="button">Share request</button></div><p class="small">Send this request to the cooperative through your usual channel. This demo has no intake or response system.</p></div>`;
    document.querySelector('#farmer-download').onclick = () => {
      const file = new Blob([draftText(draft)], {type:'text/plain;charset=utf-8'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = `paddypay-review-${draft.plotCode}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    document.querySelector('#farmer-share').onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({title:'PaddyPay review request', text:draftText(draft)}); }
        catch (error) { if (error.name !== 'AbortError') alert('Sharing was unavailable. You can download the request instead.'); }
      } else alert('This browser does not support sharing. You can download the request instead.');
    };
  };
  form.onsubmit = event => {
    event.preventDefault();
    const input = new FormData(form);
    const category = String(input.get('category'));
    const details = String(input.get('details')).trim();
    if (!categoryNames[category] || details.length < 10 || details.length > 500) return;
    draft = {plotCode:plot.code, season:receipt.season, category, details, createdAt:new Date().toLocaleString('en-US'), saleTx:receipt.saleTx};
    localStorage.setItem(draftKey, JSON.stringify(draft));
    showDraft();
    draftBox.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  showDraft();
}

start();
