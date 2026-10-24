import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// 3D digital twin of the simulated season: paddies, AWD water levels, rice growth, sensors and anchored roots.
const STATUS_COLOR = { green: '#2fb779', yellow: '#e2b33a', red: '#e0644a', pending: '#a9b5ab' };
const STATUS_TEXT = { green: 'Eligible', yellow: 'Needs evidence', red: 'Flagged', pending: 'Pending' };
const CLUSTERS = ['A', 'B', 'C'];
const PLOT = 4.4, GAP = 1.1, ROW_Z = 3.4, CLUSTER_W = 4 * (PLOT + GAP) + 3.5;
const RICE_PER_SIDE = 11;
const LEDGER_Z = -15, CELL = 0.52;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function mountTwin(container, { plots, water, explorer, registryAddress, chain, statusAt, onPick, onDay, startDay = 100 }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.classList.add('twin');
  container.innerHTML = `<div class="twin-hud">
      <div class="twin-day"><span class="twin-day-num">Day 100</span><span class="twin-day-sub">/ 100 · Winter–Spring 2026</span></div>
      <div class="twin-readouts"></div>
    </div>
    <div class="twin-event" hidden></div>
    <div class="twin-tip" hidden></div>
    <div class="twin-controls">
      <button class="twin-btn" data-act="play" aria-label="Play season">▶</button>
      <input class="twin-slider" type="range" min="1" max="100" step="1" value="100" aria-label="Season day">
      <button class="twin-btn twin-speed" data-act="speed" aria-label="Playback speed">2×</button>
      <button class="twin-btn" data-act="full" aria-label="Full screen">⤢</button>
    </div>
    <div class="twin-legend"><span><i style="background:${STATUS_COLOR.green}"></i>Eligible</span><span><i style="background:${STATUS_COLOR.yellow}"></i>Needs evidence</span><span><i style="background:${STATUS_COLOR.red}"></i>Flagged</span><span class="twin-hint">Drag to orbit · scroll to zoom · click a plot</span></div>`;
  container.prepend(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'twin-labels';
  container.append(labels.domElement);

  const scene = new THREE.Scene();
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const g = sky.getContext('2d'); const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8fc3e3'); grad.addColorStop(0.55, '#d9ecf2'); grad.addColorStop(1, '#f6eedb');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(sky);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog('#e9eee3', 70, 150);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  camera.position.set(-3, 29, 41);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, -4);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.38;
  controls.minDistance = 14;
  controls.maxDistance = 110;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  scene.add(new THREE.HemisphereLight('#e4f2ff', '#5b4a2e', 1.25));
  const sun = new THREE.DirectionalLight('#fff0d4', 2.4);
  sun.position.set(-35, 48, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 34, bottom: -34, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Ground, canals and surroundings
  const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64), new THREE.MeshStandardMaterial({ color: '#7f9a52', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
  scene.add(ground);
  const waterMat = new THREE.MeshPhysicalMaterial({ color: '#4f9fc4', roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.1 });
  const canalMat = waterMat.clone(); canalMat.color.set('#3f8db5'); canalMat.opacity = 0.92;
  const span = 3 * CLUSTER_W + 10;
  const canal = new THREE.Mesh(new THREE.BoxGeometry(span, 0.1, 1.5), canalMat);
  canal.position.set(0, 0.02, 0); scene.add(canal);
  const bankMat = new THREE.MeshStandardMaterial({ color: '#9b8455', roughness: 1 });
  for (const z of [-0.95, 0.95]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(span, 0.32, 0.4), bankMat);
    bank.position.set(0, 0.16, z); bank.castShadow = bank.receiveShadow = true; scene.add(bank);
  }
  const river = new THREE.Mesh(new THREE.PlaneGeometry(300, 9), canalMat);
  river.rotation.x = -Math.PI / 2; river.position.set(0, 0.01, 24); scene.add(river);
  // Neighbouring farmland outside the program, for context
  const patchColors = ['#8fb35a', '#9fbf62', '#7ea64e', '#b9c46a', '#a7b85c', '#6f9a48'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const patchRand = mulberry(11);
  for (let gx = -9; gx <= 9; gx++) for (let gz = -6; gz <= 3; gz++) {
    const px = gx * 7.6, pz = gz * 7.6 - 2;
    if ((Math.abs(px) < 3 * CLUSTER_W / 2 + 4 && pz > -12 && pz < 10) || (pz > -20 && pz < -10 && Math.abs(px) < 33)) continue;
    const patch = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.12, 6.8), patchColors[Math.floor(patchRand() * patchColors.length)]);
    patch.position.set(px, 0.04, pz); patch.receiveShadow = true; scene.add(patch);
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6d5235', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#4f7a37', roughness: 0.9, flatShading: true });
  const rand = mulberry(7);
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = 46 + rand() * 40;
    const x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r * 0.75 - 6;
    if (z > 15 && z < 29) continue;
    const s = 0.8 + rand() * 0.9;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 2.2 * s, 6), trunkMat);
    trunk.position.y = 1.1 * s;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 * s, 0), leafMat);
    crown.position.y = 2.8 * s; crown.scale.y = 0.85;
    trunk.castShadow = crown.castShadow = true;
    tree.add(trunk, crown); tree.position.set(x, 0, z); tree.rotation.y = rand() * 6;
    scene.add(tree);
  }

  // Paddies
  const riceGeo = new THREE.ConeGeometry(0.07, 1, 4); riceGeo.translate(0, 0.5, 0);
  const riceMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const sway = { value: 0 };
  riceMat.onBeforeCompile = shader => {
    shader.uniforms.uTime = sway;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float h = position.y * position.y;
      transformed.x += sin(uTime * 1.7 + wp.x * 0.45 + wp.z * 0.3) * 0.16 * h;
      transformed.z += cos(uTime * 1.3 + wp.x * 0.25) * 0.08 * h;`);
  };
  const totalRice = plots.length * RICE_PER_SIDE * RICE_PER_SIDE;
  const rice = new THREE.InstancedMesh(riceGeo, riceMat, totalRice);
  rice.castShadow = true;
  scene.add(rice);
  const riceBase = [];
  const tubeMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, roughness: 0.1 });
  const tubeWaterMat = new THREE.MeshStandardMaterial({ color: '#2e86c1', emissive: '#1b5f8f', emissiveIntensity: 0.4 });
  const beamGeo = new THREE.CylinderGeometry(0.16, 0.16, 7, 12, 1, true); beamGeo.translate(0, 3.5, 0);
  const pickables = [];
  const plotViews = plots.map((p, idx) => {
    const ci = CLUSTERS.indexOf(p.cluster), n = Number(p.code.split('-')[1]) - 1;
    const col = n % 4, row = Math.floor(n / 4);
    const size = PLOT * Math.min(1.05, Math.sqrt(p.areaHa / 1.3));
    const x = (ci - 1) * CLUSTER_W + (col - 1.5) * (PLOT + GAP);
    const z = row === 0 ? -ROW_Z : ROW_Z;
    const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
    const soilMat = new THREE.MeshStandardMaterial({ color: '#4c3a26', roughness: 1 });
    const soil = new THREE.Mesh(new THREE.BoxGeometry(size, 0.1, size), soilMat);
    soil.position.y = 0.05; soil.receiveShadow = true; soil.userData.plot = p;
    group.add(soil); pickables.push(soil);
    const bundMat = new THREE.MeshStandardMaterial({ color: '#8f7448', roughness: 1 });
    const b = 0.28, h = 0.38;
    for (const [w, d, bx, bz] of [[size + b, b, 0, size / 2], [size + b, b, 0, -size / 2], [b, size, size / 2, 0], [b, size, -size / 2, 0]]) {
      const bund = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bundMat);
      bund.position.set(bx, h / 2, bz); bund.castShadow = bund.receiveShadow = true; group.add(bund);
    }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.02, size - 0.02), waterMat);
    water.rotation.x = -Math.PI / 2; group.add(water);
    const edgeMat = new THREE.LineBasicMaterial({ color: STATUS_COLOR.pending, transparent: true, opacity: 0.95 });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size + b + 0.06, 0.02, size + b + 0.06)), edgeMat);
    edge.position.y = h + 0.02; group.add(edge);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 14, 1, true), tubeMat);
    const tubeX = size / 2 - 0.55, tubeZ = size / 2 - 0.55;
    tube.position.set(tubeX, 0.6, tubeZ); group.add(tube);
    const tubeWater = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 14), tubeWaterMat);
    tubeWater.position.set(tubeX, 0, tubeZ); group.add(tubeWater);
    const beamMat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.red, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.visible = false; group.add(beam);
    const tag = document.createElement('div'); tag.className = 'twin-tag'; tag.textContent = p.code;
    const label = new CSS2DObject(tag); label.position.set(0, 1.1, 0); group.add(label);
    const step = (size - 0.7) / (RICE_PER_SIDE - 1);
    for (let i = 0; i < RICE_PER_SIDE; i++) for (let j = 0; j < RICE_PER_SIDE; j++) {
      const lx = -(size - 0.7) / 2 + i * step, lz = -(size - 0.7) / 2 + j * step;
      if (lx > tubeX - 0.45 && lz > tubeZ - 0.45) continue;
      riceBase.push({ x: x + lx + (rand() - 0.5) * 0.12, z: z + lz + (rand() - 0.5) * 0.12, s: 0.8 + rand() * 0.4, r: rand() * 6, plot: idx });
    }
    return { p, soilMat, water, edgeMat, beam, beamMat, tag, tubeWater, status: 'pending' };
  });

  // Cluster sensors
  const sensors = CLUSTERS.map((c, ci) => {
    const x = (ci - 1) * CLUSTER_W - 2.75 * (PLOT + GAP) + 0.9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 8), new THREE.MeshStandardMaterial({ color: '#d7dcd6', metalness: 0.6, roughness: 0.35 }));
    pole.position.set(x, 1.7, -1.6); pole.castShadow = true; scene.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: '#1d3557', metalness: 0.4, roughness: 0.3 }));
    panel.position.set(x, 3.2, -1.6); panel.rotation.x = -0.5; scene.add(panel);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#7cf2c0', emissive: '#2fe39a', emissiveIntensity: 1.5 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bulbMat);
    bulb.position.set(x, 3.55, -1.6); scene.add(bulb);
    bulb.userData.cluster = pole.userData.cluster = c; pickables.push(bulb, pole);
    const tag = document.createElement('div'); tag.className = 'twin-cluster'; tag.innerHTML = `<b>Cluster ${c}</b><span>sensor</span>`;
    const label = new CSS2DObject(tag); label.position.set(x, 4.5, -1.6); scene.add(label);
    return { cluster: c, bulb, bulbMat, origin: new THREE.Vector3(x, 3.55, -1.6), tag };
  });

  // Ledger ribbon: one cell per cluster per day, lit when that day's Merkle root is anchored.
  const ledgerGeo = new THREE.BoxGeometry(CELL * 0.86, CELL * 0.86, CELL * 0.86);
  const ledgerMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.0 });
  const ledger = new THREE.InstancedMesh(ledgerGeo, ledgerMat, 300);
  ledger.userData.ledger = true;
  const ledgerPos = (ci, day) => new THREE.Vector3((day - 50.5) * CELL * 1.08, 4.2 + (2 - ci) * CELL * 1.25, LEDGER_Z);
  const m4 = new THREE.Matrix4();
  for (let ci = 0; ci < 3; ci++) for (let d = 1; d <= 100; d++) { m4.makeTranslation(ledgerPos(ci, d)); ledger.setMatrixAt(ci * 100 + d - 1, m4); }
  scene.add(ledger); pickables.push(ledger);
  const ledgerFrame = new THREE.Mesh(new THREE.BoxGeometry(100 * CELL * 1.08 + 1.2, 3 * CELL * 1.25 + 1, 0.2), new THREE.MeshStandardMaterial({ color: '#16382a', roughness: 0.6, metalness: 0.3 }));
  ledgerFrame.position.set(0, 4.2 + CELL * 1.25, LEDGER_Z - 0.4); scene.add(ledgerFrame);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), ledgerFrame.material);
    leg.position.set(sx * (50 * CELL * 1.08 + 0.3), 2.2, LEDGER_Z - 0.4); leg.castShadow = true; scene.add(leg);
  }
  const ledgerTag = document.createElement('div'); ledgerTag.className = 'twin-ledger';
  ledgerTag.innerHTML = `<b>${explorer ? 'Kaia Kairos' : 'Local chain'} · daily Merkle roots</b><span class="twin-ledger-count">0 / 296 anchored</span><span class="twin-ledger-hint">Click a cell to inspect its transaction</span>${explorer ? `<a href="${explorer}/address/${registryAddress}" target="_blank" rel="noopener">Open registry ↗</a>` : ''}`;
  const ledgerLabel = new CSS2DObject(ledgerTag); ledgerLabel.position.set(0, 4.2 + 3 * CELL * 1.25 + 1.2, LEDGER_Z); scene.add(ledgerLabel);
  const anchored = new Set(CLUSTERS.flatMap((c, ci) => water[c].map(w => ci * 100 + w.day - 1)));

  // Data pulses from sensors to the ledger
  const pulseGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const pulseMat = new THREE.MeshBasicMaterial({ color: '#8fffd2' });
  const pulses = [];
  function emit(ci, day) {
    const from = sensors[ci].origin.clone(), to = ledgerPos(ci, day);
    const mid = from.clone().lerp(to, 0.5); mid.y += 7;
    const mesh = new THREE.Mesh(pulseGeo, pulseMat); scene.add(mesh);
    pulses.push({ mesh, curve: new THREE.QuadraticBezierCurve3(from, mid, to), t: 0, cell: ci * 100 + day - 1 });
  }

  const waterAt = (c, day) => {
    const series = water[c]; const lo = Math.floor(day), hi = Math.min(100, lo + 1);
    const a = series.find(w => w.day === lo), b = series.find(w => w.day === hi);
    if (!a && !b) return null;
    if (!a || !b) return (a ?? b).cm;
    return a.cm + (b.cm - a.cm) * (day - lo);
  };
  const ledgerColor = new THREE.Color(), dryColor = new THREE.Color('#a88a5f'), wetColor = new THREE.Color('#4a3926');
  const youngRice = new THREE.Color('#7ccf4d'), ripeRice = new THREE.Color('#d9b84a'), riceColor = new THREE.Color();
  let litDay = 0;
  function setLedger(day) {
    let count = 0;
    for (let i = 0; i < 300; i++) {
      const d = i % 100 + 1, on = d <= day && anchored.has(i), gap = d <= day && !anchored.has(i);
      if (on) count++;
      ledgerColor.set(on ? (i < 100 ? '#43d39a' : i < 200 ? '#3fc0d6' : '#7c9bf0') : gap ? '#5a2a26' : '#284636');
      ledger.setColorAt(i, ledgerColor);
    }
    ledger.instanceColor.needsUpdate = true;
    ledgerTag.querySelector('.twin-ledger-count').textContent = `${count} / ${anchored.size} anchored`;
    litDay = day;
  }

  let day = 100, playing = false, speed = 2, lastDay = 100;
  const slider = container.querySelector('.twin-slider');
  const playBtn = container.querySelector('[data-act="play"]');
  const dayNum = container.querySelector('.twin-day-num');
  const readouts = container.querySelector('.twin-readouts');
  const eventBox = container.querySelector('.twin-event');
  const events = [];
  const byCode = c => plots.find(p => p.code === c);
  for (const p of plots) {
    if (p.status === 'red') {
      const d = [...Array(100).keys()].map(i => i + 1).find(d => statusAt(p, d) === 'red');
      if (d) events.push({ from: d, to: d + 12, text: `<b>${esc(p.code)}</b> flagged · ${esc(p.reasons[0])}`, kind: 'red' });
    }
  }
  const outage = water.C ? [...Array(100).keys()].map(i => i + 1).filter(d => !water.C.some(w => w.day === d)) : [];
  if (outage.length) events.push({ from: outage[0], to: outage.at(-1) + 6, text: `<b>Cluster C</b> sensor offline · days ${outage[0]}–${outage.at(-1)} have no anchored root`, kind: 'yellow' });
  const counts = s => plots.filter(p => p.status === s).length;
  events.push({ from: 83, to: 101, text: `<b>Season assessed</b> · ${counts('green')} eligible · ${counts('yellow')} need evidence · ${counts('red')} flagged`, kind: 'green' });
  if (byCode('A-01')?.status === 'green') events.push({ from: 92, to: 101, text: '<b>Payouts</b> · 70% of each sale goes to the farmer', kind: 'green' });

  let reportedDay = null;
  function apply(t) {
    const dInt = Math.max(1, Math.min(100, Math.round(t)));
    dayNum.textContent = `Day ${dInt}`;
    if (dInt !== reportedDay) { reportedDay = dInt; onDay?.(dInt); }
    slider.value = dInt;
    const growth = 0.18 + 0.95 * smooth(0, 75, t), ripe = smooth(72, 100, t);
    riceColor.copy(youngRice).lerp(ripeRice, ripe);
    let k = 0;
    const q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const r of riceBase) {
      pos.set(r.x, 0.1, r.z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.r); scl.set(1, growth * 1.35 * r.s, 1);
      m4.compose(pos, q, scl); rice.setMatrixAt(k, m4); rice.setColorAt(k, riceColor); k++;
    }
    rice.count = k; rice.instanceMatrix.needsUpdate = true; rice.instanceColor.needsUpdate = true;
    const html = [];
    for (const v of plotViews) {
      const cm = waterAt(v.p.cluster, t) ?? waterAt(v.p.cluster, Math.floor(t) - 1) ?? 0;
      v.water.visible = cm > -0.5;
      v.water.position.y = 0.1 + Math.max(0, cm) * 0.06;
      v.soilMat.color.copy(wetColor).lerp(dryColor, smooth(0, 12, -cm));
      const tubeH = Math.max(0.04, (cm + 15) / 20 * 1.15);
      v.tubeWater.scale.y = tubeH; v.tubeWater.position.y = tubeH / 2;
      const status = statusAt(v.p, dInt);
      if (status !== v.status) {
        v.status = status;
        v.edgeMat.color.set(STATUS_COLOR[status]);
        v.tag.dataset.status = status;
        v.beam.visible = status === 'red' || status === 'yellow';
        v.beamMat.color.set(STATUS_COLOR[status]);
      }
      v.cm = cm;
    }
    for (const [ci, s] of sensors.entries()) {
      const cm = waterAt(s.cluster, t), offline = cm === null || !water[s.cluster].some(w => w.day === dInt);
      s.offline = offline;
      s.bulbMat.emissive.set(offline ? '#ff5a3d' : '#2fe39a');
      s.bulbMat.color.set(offline ? '#ff9b88' : '#7cf2c0');
      html.push(`<div class="twin-read ${offline ? 'off' : ''}"><b>${s.cluster}</b><span>${offline ? 'offline' : `${Math.round(cm)} cm`}</span><small>${offline ? 'no reading' : cm < -1 ? 'dry-down' : 'flooded'}</small></div>`);
    }
    readouts.innerHTML = html.join('');
    const ev = events.filter(e => dInt >= e.from && dInt < e.to).at(-1);
    eventBox.hidden = !ev;
    if (ev) { eventBox.className = `twin-event ${ev.kind}`; eventBox.innerHTML = ev.text; }
  }

  function setDay(d, { animatePulses = false } = {}) {
    const prev = Math.round(day);
    day = d;
    const now = Math.round(day);
    if (animatePulses) {
      for (let x = prev + 1; x <= now; x++) CLUSTERS.forEach((c, ci) => { if (anchored.has(ci * 100 + x - 1)) emit(ci, x); });
    } else if (now !== litDay) setLedger(now);
    apply(day);
  }

  slider.addEventListener('input', () => { playing = false; playBtn.textContent = '▶'; pulses.splice(0).forEach(p => scene.remove(p.mesh)); setDay(Number(slider.value)); setLedger(Math.round(day)); });
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  container.querySelector('[data-act="speed"]').addEventListener('click', e => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; e.currentTarget.textContent = `${speed}×`; });
  container.querySelector('[data-act="full"]').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : container.requestFullscreen?.()));
  function play() {
    if (day >= 100) { pulses.splice(0).forEach(p => scene.remove(p.mesh)); day = 1; setLedger(0); apply(1); CLUSTERS.forEach((c, ci) => { if (anchored.has(ci * 100)) emit(ci, 1); }); }
    playing = true; playBtn.textContent = '❚❚'; controls.autoRotate = !reduceMotion;
  }
  function pause() { playing = false; playBtn.textContent = '▶'; }

  // Hover and click
  const tip = container.querySelector('.twin-tip');
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let hovered = null, downAt = null, selected = null;
  // Returns what is under the pointer: a plot, a ledger cell (cluster + day) or a cluster sensor.
  const pick = e => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables)[0];
    if (!hit) return null;
    if (hit.object.userData.plot) return { plot: hit.object.userData.plot };
    if (hit.object.userData.cluster) return { cluster: hit.object.userData.cluster };
    if (hit.object.userData.ledger && hit.instanceId != null) return { cluster: CLUSTERS[Math.floor(hit.instanceId / 100)], day: hit.instanceId % 100 + 1, cell: hit.instanceId };
    return null;
  };
  const place = e => { const r = container.getBoundingClientRect(); tip.hidden = false; tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 250)}px`; tip.style.top = `${Math.max(8, e.clientY - r.top - 10)}px`; };
  renderer.domElement.addEventListener('pointermove', e => {
    const h = pick(e), p = h?.plot ?? null;
    renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
    if (p !== hovered) plotViews.forEach(v => v.tag.classList.toggle('hot', v.p === p));
    hovered = p;
    if (!h) { tip.hidden = true; return; }
    place(e);
    if (p) {
      const v = plotViews.find(x => x.p === p);
      tip.innerHTML = `<div class="twin-tip-head"><b>${p.code}</b><span class="twin-pill" style="background:${STATUS_COLOR[v.status]}">${STATUS_TEXT[v.status]}</span></div><div>${p.areaHa} ha · cluster ${p.cluster}</div><div>Water ${Math.round(v.cm)} cm · day ${Math.round(day)}</div>${p.status === 'green' && p.tMilli ? `<div>${(p.tMilli / 1000).toFixed(3)} tCO₂e estimated</div>` : ''}<div class="twin-tip-foot">${v.status === 'pending' ? 'Assessment pending' : esc(p.reasons[0])}</div><small>Click to inspect on-chain records →</small>`;
    } else if (h.day) {
      const entry = chain?.days[h.cluster]?.find(d => d.day === h.day);
      const tx = entry?.tx && chain.txs.find(t => t.hash === entry.tx);
      tip.innerHTML = `<div class="twin-tip-head"><b>Day ${h.day} · ${h.cluster}</b><span class="twin-pill" style="background:${entry ? '#2fa37a' : '#b8432e'}">${entry ? 'anchored' : 'missing'}</span></div>${entry ? `<div class="twin-mono">root ${entry.root.slice(0, 10)}…${entry.root.slice(-6)}</div><div>${entry.count} signed readings</div>${tx ? `<div class="twin-mono">tx ${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}</div><div>block #${tx.block.toLocaleString('en-US')}</div>` : ''}` : '<div>Sensor offline — no root anchored</div>'}<small>Click to inspect →</small>`;
    } else {
      tip.innerHTML = `<div class="twin-tip-head"><b>Cluster ${h.cluster} sensor</b></div>${chain ? `<div class="twin-mono">${chain.devices[h.cluster].slice(0, 10)}…${chain.devices[h.cluster].slice(-6)}</div>` : ''}<div>Signs every reading (EIP-191)</div><small>Click to inspect →</small>`;
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; hovered = null; plotViews.forEach(v => v.tag.classList.remove('hot')); });
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const h = pick(e); if (!h) return;
    if (h.plot) {
      selected = h.plot.code;
      plotViews.forEach(v => v.tag.classList.toggle('sel', v.p.code === selected));
      onPick?.({ plot: selected, cluster: h.plot.cluster });
    } else if (h.day) {
      pause(); pulses.splice(0).forEach(p => scene.remove(p.mesh)); setDay(h.day); setLedger(h.day);
      onPick?.({ cluster: h.cluster, day: h.day });
    } else onPick?.({ cluster: h.cluster });
  });

  let sized = false;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h); labels.setSize(w, h);
    camera.aspect = w / h;
    if (!sized && w < 640) { camera.position.set(44, 50, 30); controls.target.set(0, 0, 0); }
    sized = true;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  day = Math.max(1, Math.min(100, Math.round(startDay)));
  setLedger(day); apply(day);
  const clock = new THREE.Clock();
  let raf;
  function frame() {
    if (!container.isConnected) return dispose();
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1), time = clock.elapsedTime;
    sway.value = reduceMotion ? 0 : time;
    if (playing) {
      const next = Math.min(100, day + dt * speed * 2.2);
      setDay(next, { animatePulses: true });
      if (next >= 100) pause();
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]; p.t += dt * 1.6;
      p.mesh.position.copy(p.curve.getPoint(Math.min(1, p.t)));
      if (p.t >= 1) {
        scene.remove(p.mesh); pulses.splice(i, 1);
        const d = p.cell % 100 + 1;
        ledger.setColorAt(p.cell, ledgerColor.set(p.cell < 100 ? '#43d39a' : p.cell < 200 ? '#3fc0d6' : '#7c9bf0'));
        ledger.instanceColor.needsUpdate = true;
        if (d > litDay) litDay = d;
        const count = [...anchored].filter(c => c % 100 + 1 <= litDay).length;
        ledgerTag.querySelector('.twin-ledger-count').textContent = `${count} / ${anchored.size} anchored`;
      }
    }
    // Fill skipped outage cells once the playhead passes them.
    if (playing) {
      for (let ci = 0; ci < 3; ci++) for (let d = 1; d <= Math.round(day); d++) if (!anchored.has(ci * 100 + d - 1)) ledger.setColorAt(ci * 100 + d - 1, ledgerColor.set('#5a2a26'));
      ledger.instanceColor.needsUpdate = true;
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    for (const v of plotViews) if (v.beam.visible) v.beamMat.opacity = (v.status === 'red' ? 0.28 : 0.16) + pulse * 0.22;
    for (const s of sensors) s.bulbMat.emissiveIntensity = s.offline ? 0.6 + pulse * 1.2 : 1.2 + (playing ? pulse * 0.8 : 0);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  frame();

  function dispose() {
    cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
    scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material ?? []).forEach(m => m.dispose()); });
    renderer.dispose();
  }
  return {
    replay() { pause(); day = 100; play(); },
    clearSelection() { selected = null; plotViews.forEach(v => v.tag.classList.remove('sel')); },
    dispose,
  };
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
