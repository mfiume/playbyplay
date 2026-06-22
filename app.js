/* ===========================================================================
   Bombers · Play-by-Play
   A tap-to-score baseball scorecard that tracks every play and every runner's
   trip around the bases — for BOTH teams. Vanilla JS, no build, localStorage.
   The diamond is the hero: runner tokens glide base-to-base along the paths.
   =========================================================================== */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const STORE = 'bombers-pbp-v1';
  const ROSTER = { away: 'bombers-roster-away-v1', home: 'bombers-roster-home-v1' };
  const STEP = 240; // ms per base of runner travel

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1900);
  }

  // ---------- result definitions ----------
  // reach: base the batter lands on (4 = scores). Runners are NOT auto-advanced;
  // only the minimum "force" needed to avoid two runners sharing a base is applied
  // (this also produces the correct walk force). rbiOk: a run during this batter's
  // turn is credited to them. Everything else is the scorekeeper's call (tap a runner).
  const R = {
    '1B':  { label: 'Single',          tag: '1B',  hit: 1, ab: 1, reach: 1, rbiOk: 1 },
    '2B':  { label: 'Double',          tag: '2B',  hit: 1, ab: 1, reach: 2, rbiOk: 1 },
    '3B':  { label: 'Triple',          tag: '3B',  hit: 1, ab: 1, reach: 3, rbiOk: 1 },
    'HR':  { label: 'Home run',        tag: 'HR',  hit: 1, ab: 1, reach: 4, rbiOk: 1 },
    'BB':  { label: 'Walk',            tag: 'BB',  bb: 1, reach: 1, rbiOk: 1 },
    'HBP': { label: 'Hit by pitch',    tag: 'HP',  bb: 1, reach: 1, rbiOk: 1 },
    'ROE': { label: 'Reached on error',tag: 'E',   ab: 1, reach: 1, roe: 1 },
    'FC':  { label: "Fielder's choice",tag: 'FC',  ab: 1, reach: 1, rbiOk: 1 },
    'K':   { label: 'Strikeout',       tag: 'K',   ab: 1, out: 1, so: 1 },
    'GO':  { label: 'Ground out',      tag: 'GO',  ab: 1, out: 1, rbiOk: 1 },
    'FO':  { label: 'Fly out',         tag: 'F',   ab: 1, out: 1, rbiOk: 1 },
    'PO':  { label: 'Pop / line out',  tag: 'P',   ab: 1, out: 1, rbiOk: 1 },
    'SAC': { label: 'Sacrifice',       tag: 'SAC', out: 1, sac: 1, rbiOk: 1 },
    'DP':  { label: 'Double play',     tag: 'DP',  ab: 1, out: 2 },
  };

  // ---------- default rosters ----------
  const BOMBERS = [
    { num: '15', name: 'Ozzy Day', pos: '' }, { num: '17', name: 'Emmett Pitton', pos: '' },
    { num: '19', name: 'Alexander Fiume', pos: '' }, { num: '9', name: 'Devin Sen', pos: '' },
    { num: '35', name: 'Connor Nascimento', pos: '' }, { num: '10', name: 'Everett Funston', pos: '' },
    { num: '14', name: 'Gregory Stratigopoulos', pos: '' }, { num: '99', name: 'Lincoln Shamliyan Bowen', pos: '' },
    { num: '5', name: 'Adrian Stevanovic', pos: '' }, { num: '12', name: 'Ryder Varrik', pos: '' },
    { num: '7', name: 'Axel Pettengell', pos: '' }, { num: '36', name: 'James Reason', pos: '' },
    { num: '78', name: 'William Manz', pos: '' },
  ];
  const mkPlayers = (arr) => arr.map(p => ({ id: uid(), num: p.num, name: p.name, pos: p.pos || '' }));

  // ---------- state ----------
  let g;
  const undoStack = [];
  let editTeam = 'home';   // which lineup the setup editor is showing
  let animChain = Promise.resolve();
  let popPaId = null;      // runner the quick-action popover targets

  function blankLive() {
    return {
      started: false, inning: 1, half: 'top', outs: 0,
      bases: { 1: null, 2: null, 3: null },
      idx: { away: 0, home: 0 },
      pas: [],
      runs: { away: 0, home: 0 },
      halfRuns: 0,         // runs in the current half-inning (for the mercy rule)
      pendingPaId: null,   // the batter currently credited for runs that score
    };
  }
  function blankGame() {
    return {
      meta: {
        date: '', place: '', mercy: 5,
        away: { name: 'Visitors', color: '#34C0D9' },
        home: { name: 'Bombers', color: '#E5484D' },
      },
      teams: { away: [], home: mkPlayers(BOMBERS) },
      live: blankLive(),
    };
  }

  function save() { try { localStorage.setItem(STORE, JSON.stringify(g)); } catch (e) {} }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) { g = JSON.parse(raw); return true; }
    } catch (e) {}
    g = blankGame();
    return false;
  }

  // ---------- side helpers ----------
  const battingSide = () => (g.live.half === 'top' ? 'away' : 'home');
  const fieldingSide = () => (g.live.half === 'top' ? 'home' : 'away');
  const lineup = (side = battingSide()) => g.teams[side];
  const teamColor = (side) => g.meta[side].color;
  const teamName = (side) => g.meta[side].name || (side === 'away' ? 'Away' : 'Home');
  function currentBatter() {
    const lu = lineup();
    if (!lu.length) return null;
    return lu[g.live.idx[battingSide()] % lu.length];
  }
  function onDeck() {
    const lu = lineup();
    if (lu.length < 2) return null;
    return lu[(g.live.idx[battingSide()] + 1) % lu.length];
  }
  const paById = (id) => g.live.pas.find(p => p.id === id);
  function playerById(id) {
    for (const s of ['away', 'home']) { const p = g.teams[s].find(x => x.id === id); if (p) return p; }
    return null;
  }

  // =========================================================================
  //  SETUP — two-team lineup editor
  // =========================================================================
  function addPlayer() {
    const num = $('#np-num').value.trim();
    const name = $('#np-name').value.trim();
    const pos = $('#np-pos').value.trim().toUpperCase();
    if (!name) { toast('Enter a player name'); return; }
    g.teams[editTeam].push({ id: uid(), num, name, pos });
    $('#np-num').value = ''; $('#np-name').value = ''; $('#np-pos').value = '';
    $('#np-name').focus(); save(); renderLineup();
  }
  function fill9() {
    const lu = g.teams[editTeam];
    for (let i = lu.length; i < 9; i++) lu.push({ id: uid(), num: String(i + 1), name: 'Batter ' + (i + 1), pos: '' });
    save(); renderLineup();
  }
  function moveRow(id, dir) {
    const lu = g.teams[editTeam];
    const i = lu.findIndex(p => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lu.length) return;
    [lu[i], lu[j]] = [lu[j], lu[i]];
    save(); renderLineup();
  }
  function delRow(id) {
    g.teams[editTeam] = g.teams[editTeam].filter(p => p.id !== id);
    save(); renderLineup();
  }
  function renderLineup() {
    const ol = $('#lineup-list');
    document.documentElement.style.setProperty('--turn', teamColor(editTeam));
    const lu = g.teams[editTeam];
    ol.innerHTML = '';
    lu.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'lineup-row';
      li.innerHTML =
        `<span class="ln-order">${i + 1}</span>` +
        `<span class="ln-jersey">${p.num ? '#' + esc(p.num) : '·'}</span>` +
        `<span class="ln-name">${esc(p.name)}</span>` +
        `<span class="ln-pos">${esc(p.pos || '')}</span>` +
        `<span class="ln-move"><button data-up="${p.id}" aria-label="Move up">▲</button>` +
        `<button data-down="${p.id}" aria-label="Move down">▼</button></span>` +
        `<button class="ln-del" data-del="${p.id}" aria-label="Remove">×</button>`;
      ol.appendChild(li);
    });
    $('#lineup-hint').textContent = lu.length
      ? `${lu.length} in the ${editTeam} order — ▲▼ to reorder.`
      : `Add the ${editTeam} batting order, or tap “Fill 9 spots”.`;
  }
  function switchEditTeam(team) {
    editTeam = team;
    $$('.team-tab').forEach(t => t.classList.toggle('active', t.dataset.team === team));
    renderLineup();
  }
  function saveRoster() {
    try { localStorage.setItem(ROSTER[editTeam], JSON.stringify(g.teams[editTeam])); toast(`${cap(editTeam)} roster saved`); } catch (e) {}
  }
  function loadRoster() {
    try {
      const raw = localStorage.getItem(ROSTER[editTeam]);
      if (!raw) {
        if (editTeam === 'home') { g.teams.home = mkPlayers(BOMBERS); save(); renderLineup(); toast('Loaded default Bombers roster'); }
        else toast('No saved away roster yet');
        return;
      }
      g.teams[editTeam] = JSON.parse(raw).map(p => ({ ...p, id: p.id || uid() }));
      save(); renderLineup(); toast(`${cap(editTeam)} roster loaded`);
    } catch (e) { toast('Could not load roster'); }
  }

  // =========================================================================
  //  GAME CONTROL
  // =========================================================================
  function readMeta() {
    g.meta.date = $('#f-date').value;
    g.meta.place = $('#f-place').value.trim();
    g.meta.away.name = $('#f-away').value.trim() || 'Visitors';
    g.meta.home.name = $('#f-home').value.trim() || 'Bombers';
    g.meta.away.color = $('#f-away-color').value;
    g.meta.home.color = $('#f-home-color').value;
    g.meta.mercy = Math.max(0, parseInt($('#f-mercy').value, 10) || 0);
  }
  function fillMeta() {
    $('#f-date').value = g.meta.date || new Date().toISOString().slice(0, 10);
    $('#f-place').value = g.meta.place;
    $('#f-mercy').value = g.meta.mercy != null ? g.meta.mercy : 5;
    $('#f-away').value = g.meta.away.name;
    $('#f-home').value = g.meta.home.name;
    $('#f-away-color').value = g.meta.away.color;
    $('#f-home-color').value = g.meta.home.color;
  }
  function startGame() {
    readMeta();
    if (!g.teams.away.length || !g.teams.home.length) { toast('Both teams need a batting order'); return; }
    g.live = blankLive();
    g.live.started = true;
    undoStack.length = 0;
    save();
    showView('game');
    renderAll();
    clearTokens();
    toast('Play ball ⚾');
  }
  function snapshot() {
    undoStack.push(clone(g.live));
    if (undoStack.length > 80) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    g.live = undoStack.pop();
    save(); renderAll(); rebuildTokens(); toast('Undid last play');
  }
  function endHalf(silent) {
    const lv = g.live;
    lv.bases = { 1: null, 2: null, 3: null };
    lv.outs = 0;
    lv.halfRuns = 0;
    lv.pendingPaId = null;
    if (lv.half === 'top') lv.half = 'bottom';
    else { lv.half = 'top'; lv.inning += 1; }
    save();
    if (!silent) { renderAll(); rebuildTokens(); }
  }

  // ---------- the heart: apply one batting outcome ----------
  function applyOutcome(code) {
    const meta = R[code];
    if (!meta || !g.live.started) return;
    const batter = currentBatter();
    if (!batter) return;
    snapshot();
    const lv = g.live;
    const side = battingSide();
    const before = { 1: lv.bases[1] && lv.bases[1].paId, 2: lv.bases[2] && lv.bases[2].paId, 3: lv.bases[3] && lv.bases[3].paId };

    const pa = {
      id: uid(), side, inning: lv.inning, batterId: batter.id,
      result: code, rbi: 0, reached: 0, scored: false,
    };
    const scored = [];   // paIds that crossed the plate this play
    let runs = 0;

    if (meta.out) {
      lv.outs += Math.min(meta.out, 3);            // out(s); runners are NOT moved automatically
    } else if (meta.reach >= 4) {
      runs += forceMinimal(4, scored);             // a home run forces everyone home
      scored.push(pa.id); pa.scored = true; addRun(side);
      runs += 1;                                   // batter drives in himself too
    } else {
      runs += forceMinimal(meta.reach, scored);    // only runners truly forced advance
      lv.bases[meta.reach] = mkRunner(pa, batter, side);
    }

    if (meta.rbiOk) pa.rbi = runs;                 // forced runs are RBIs when eligible
    lv.pas.push(pa);
    lv.pendingPaId = pa.id;                         // runs scored before the next batter credit this one
    lv.idx[side] = (lv.idx[side] + 1) % Math.max(lineup(side).length, 1);

    const after = { 1: lv.bases[1] && lv.bases[1].paId, 2: lv.bases[2] && lv.bases[2].paId, 3: lv.bases[3] && lv.bases[3].paId };
    const end = halfOver();

    // ----- build the animation, then commit -----
    const plan = buildPlan(before, after, scored, pa, meta, side);
    save();
    renderScorebar(); renderNowBatting(); renderPlays(); renderBox();

    let msg = `${batter.num ? '#' + batter.num + ' ' : ''}${batter.name}: ${meta.label}`;
    if (runs) msg += ` · ${runs} in`;
    if (end) msg += ` · ${end}`;
    else if (baseRunnersOn() && meta.reach < 4) msg += ' · tap runners to move them';

    enqueue(async () => {
      await animatePlan(plan);
      if (end) { await wait(280); await sweepTokens(); endHalf(true); renderAll(); }
    });
    toast(msg);
  }

  function mkRunner(pa, batter, side) { return { paId: pa.id, batterId: batter.id, side, num: batter.num }; }
  function baseRunnersOn() { const b = g.live.bases; return !!(b[1] || b[2] || b[3]); }

  // Advance runners ONLY as far as physics forces them: a trailing runner can't be
  // passed and two runners can't share a base. Everything past this minimum is the
  // scorekeeper's call. `reach` is the batter's final base (4 = home, for a HR).
  // This single rule yields the correct force for both hits and walks.
  function forceMinimal(reach, scored) {
    const lv = g.live; let runs = 0; const nb = { 1: null, 2: null, 3: null };
    let last = reach;                              // the base just filled behind this runner
    for (const b of [1, 2, 3]) {
      const r = lv.bases[b]; if (!r) continue;
      const fin = Math.max(b, last + 1);           // must stay ahead of the runner behind
      last = fin;
      if (fin >= 4) { runs++; scored.push(r.paId); markScored(r.paId); addRun(r.side); }
      else nb[fin] = r;
    }
    lv.bases = nb; return runs;
  }
  function addRun(side) { g.live.runs[side] += 1; g.live.halfRuns += 1; }
  function markScored(paId) { const p = paById(paId); if (p) p.scored = true; }
  // Credit a manually-scored run to the batter whose turn it is, unless it was a
  // steal of home (or the at-bat doesn't earn RBIs, e.g. a strikeout or error).
  function creditRbi(action) {
    if (action === 'steal') return;
    const pa = paById(g.live.pendingPaId);
    if (pa && R[pa.result] && R[pa.result].rbiOk) pa.rbi = (pa.rbi || 0) + 1;
  }

  // ---------- manual runner actions (tap a token) ----------
  // Every move keeps the bases legal: runners can't pass each other or share a base,
  // and a trailing runner can't reach a base without the runners ahead clearing it.
  // So advancing/scoring a runner cascades the runners ahead of him as needed.
  function runnerAction(paId, action) {
    const lv = g.live;
    let base = null;
    for (const b of [1, 2, 3]) if (lv.bases[b] && lv.bases[b].paId === paId) base = b;
    if (base == null) { hidePop(); return; }
    snapshot();
    const side = lv.bases[base].side;
    const plan = { journeys: [], scoreBump: null };
    let scoredCount = 0, label;

    if (action === 'out') {
      lv.bases[base] = null; lv.outs += 1;
      plan.journeys.push({ paId, from: base, to: base, exit: 'out' });
      label = 'Out on the bases';

    } else if (action === 'back') {
      const t = base - 1;
      if (t < 1) { hidePop(); undoStack.pop(); return; }
      if (lv.bases[t]) { hidePop(); toast('A runner is already on that base'); undoStack.pop(); return; }
      lv.bases[t] = lv.bases[base]; lv.bases[base] = null;
      plan.journeys.push({ paId, from: base, to: t });
      label = 'Back a base';

    } else if (action === 'score' || base === 3) {
      // this runner scores — so does everyone ahead of him (higher base)
      for (const b of [3, 2, 1]) {
        if (b < base) break;
        const r = lv.bases[b]; if (!r) continue;
        lv.bases[b] = null; markScored(r.paId); addRun(r.side);
        creditRbi(b === base ? action : 'adv');
        plan.journeys.push({ paId: r.paId, from: b, to: 4, exit: 'score' });
        scoredCount++;
      }
      plan.scoreBump = side;
      label = scoredCount > 1 ? `${scoredCount} score` : (action === 'steal' ? 'Steal of home' : 'Run scores');

    } else { // adv / steal by one base — push the blocking runners ahead up one too
      let top = base;
      while (top + 1 <= 3 && lv.bases[top + 1]) top++;
      for (let b = top; b >= base; b--) {
        const r = lv.bases[b]; lv.bases[b] = null;
        const t = b + 1;
        if (t >= 4) { markScored(r.paId); addRun(r.side); creditRbi(action); plan.journeys.push({ paId: r.paId, from: b, to: 4, exit: 'score' }); scoredCount++; }
        else { lv.bases[t] = r; plan.journeys.push({ paId: r.paId, from: b, to: t }); }
      }
      if (scoredCount) plan.scoreBump = side;
      label = action === 'steal' ? 'Stolen base' : (top > base ? 'Runners advance' : 'Advanced');
    }

    hidePop();
    finishHalf(plan, label, action === 'out');
  }
  // Commit a play's animation, then end the half if it's over (3 outs or mercy rule).
  function finishHalf(plan, label, fromOut) {
    const lv = g.live;
    save();
    renderScorebar(); renderNowBatting(); renderPlays(); renderBox();
    const end = halfOver();
    if (end) {
      enqueue(async () => { await animatePlan(plan); await wait(240); await sweepTokens(); endHalf(true); renderAll(); });
      toast(`${label} · ${end}`);
    } else {
      enqueue(() => animatePlan(plan));
      toast(label);
    }
  }
  // Returns a reason string if the half should end, else null.
  function halfOver() {
    if (g.live.outs >= 3) return 'side retired';
    const m = +g.meta.mercy || 0;
    if (m > 0 && g.live.halfRuns >= m) return `mercy rule · ${m} runs`;
    return null;
  }

  // =========================================================================
  //  THE DIAMOND — canvas field + animated runner tokens
  // =========================================================================
  const BASE_XY = { 0: [50, 86], 1: [82, 54], 2: [50, 22], 3: [18, 54], 4: [50, 86] }; // % of stage
  let canvas, ctx, stage;

  function drawField() {
    if (!canvas) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(rect.width, 1), h = Math.max(rect.height, 1);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (p) => (p / 100) * w, Y = (p) => (p / 100) * h;
    const [hx, hy] = BASE_XY[0], [fx, fy] = BASE_XY[1], [sx, sy] = BASE_XY[2], [tx, ty] = BASE_XY[3];

    // grass field (rounded) + dusk vignette
    const grass = ctx.createRadialGradient(X(50), Y(60), X(8), X(50), Y(55), X(75));
    grass.addColorStop(0, '#3a7d51'); grass.addColorStop(1, '#244f33');
    roundRect(ctx, 0, 0, w, h, X(5)); ctx.fillStyle = grass; ctx.fill();

    // mowing arcs
    ctx.save(); ctx.clip(); ctx.globalAlpha = .08; ctx.strokeStyle = '#fff'; ctx.lineWidth = X(3.4);
    for (let r = 16; r < 90; r += 11) { ctx.beginPath(); ctx.arc(X(hx), Y(hy), X(r), Math.PI, 2 * Math.PI); ctx.stroke(); }
    ctx.restore();

    // outfield foul-territory wedge darker outside the lines
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath(); ctx.moveTo(X(hx), Y(hy)); ctx.lineTo(0, 0); ctx.lineTo(0, h); ctx.lineTo(X(hx), Y(hy)); ctx.fill();
    ctx.beginPath(); ctx.moveTo(X(hx), Y(hy)); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(X(hx), Y(hy)); ctx.fill();
    ctx.restore();

    // infield clay (diamond) with a little grass center
    const clay = ctx.createLinearGradient(0, Y(20), 0, Y(90));
    clay.addColorStop(0, '#c5774a'); clay.addColorStop(1, '#a85c34');
    ctx.fillStyle = clay;
    polygon(ctx, [[X(hx), Y(hy)], [X(fx), Y(fy)], [X(sx), Y(sy)], [X(tx), Y(ty)]]);
    ctx.fill();

    // grass infield patch
    ctx.fillStyle = grass;
    const k = 0.46;
    polygon(ctx, [
      [X(hx), Y(hy - (hy - sy) * 0)], // keep home corner clay (dirt around plate)
      [lerp(X(hx), X(fx), k), lerp(Y(hy), Y(fy), k)],
      [X(sx), lerp(Y(sy), Y(hy), 1 - k * 1.1)],
      [lerp(X(hx), X(tx), k), lerp(Y(hy), Y(ty), k)],
    ]);
    ctx.fill();

    // chalk foul lines (home past 1B and 3B to the corners)
    ctx.strokeStyle = 'rgba(237,232,218,.9)'; ctx.lineWidth = X(0.9); ctx.lineCap = 'round';
    line(ctx, X(hx), Y(hy), X(hx) + (X(fx) - X(hx)) * 2.2, Y(hy) + (Y(fy) - Y(hy)) * 2.2);
    line(ctx, X(hx), Y(hy), X(hx) + (X(tx) - X(hx)) * 2.2, Y(hy) + (Y(ty) - Y(hy)) * 2.2);

    // base paths (diamond edges)
    ctx.lineWidth = X(0.7); ctx.strokeStyle = 'rgba(237,232,218,.55)';
    polygon(ctx, [[X(hx), Y(hy)], [X(fx), Y(fy)], [X(sx), Y(sy)], [X(tx), Y(ty)]]); ctx.stroke();

    // pitcher's mound
    ctx.fillStyle = '#bf7048'; ctx.beginPath(); ctx.arc(X(50), Y(55), X(6.5), 0, 7); ctx.fill();
    ctx.fillStyle = '#e9e3d6'; ctx.fillRect(X(48.6), Y(54.2), X(2.8), Y(1.2));

    // bases (white squares) + home plate
    drawBase(ctx, X(fx), Y(fy), X(4)); drawBase(ctx, X(sx), Y(sy), X(4)); drawBase(ctx, X(tx), Y(tx === tx ? ty : ty), X(4));
    drawBase(ctx, X(tx), Y(ty), X(4));
    drawHome(ctx, X(hx), Y(hy), X(4.4));
  }
  function drawBase(c, x, y, s) { c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = '#f4efe3'; c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 6; c.fillRect(-s / 2, -s / 2, s, s); c.restore(); }
  function drawHome(c, x, y, s) { c.save(); c.fillStyle = '#f4efe3'; c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 6; c.beginPath(); c.moveTo(x - s, y - s * .5); c.lineTo(x + s, y - s * .5); c.lineTo(x + s, y + s * .2); c.lineTo(x, y + s); c.lineTo(x - s, y + s * .2); c.closePath(); c.fill(); c.restore(); }
  function polygon(c, pts) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); }
  function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  const lerp = (a, b, t) => a + (b - a) * t;

  // ----- runner tokens -----
  const tokenEls = {}; // paId -> element
  function clearTokens() { $('#runner-layer').innerHTML = ''; for (const k in tokenEls) delete tokenEls[k]; }
  function setCoord(el, base) {
    const [x, y] = BASE_XY[base];
    el.style.left = x + '%'; el.style.top = y + '%';
    el.dataset.base = base;
  }
  function makeToken(paId, base, side, num) {
    const el = document.createElement('div');
    el.className = 'runner ' + side + ' enter';
    el.style.setProperty('--c', teamColor(side));
    el.innerHTML = `<span class="runner-num">${num ? esc(num) : '•'}</span>`;
    setCoord(el, base);
    el.addEventListener('click', (e) => { e.stopPropagation(); openPop(paId, el); });
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
    $('#runner-layer').appendChild(el);
    tokenEls[paId] = el;
    return el;
  }
  // Build a movement plan by diffing base occupancy before/after.
  function buildPlan(before, after, scored, batterPa, meta, side) {
    const journeys = [];
    const baseOf = (map, paId) => { for (const b of [1, 2, 3]) if (map[b] === paId) return +b; return null; };
    const seen = new Set();
    // runners that scored
    scored.forEach(paId => {
      if (paId === batterPa.id) return; // batter handled below
      const from = baseOf(before, paId) ?? 0;
      journeys.push({ paId, from, to: 4, exit: 'score', side });
      seen.add(paId);
    });
    // runners still on base whose base changed (or unchanged — set anyway)
    for (const b of [1, 2, 3]) {
      const paId = after[b]; if (!paId || seen.has(paId)) continue;
      if (paId === batterPa.id) continue;
      const from = baseOf(before, paId) ?? 0;
      journeys.push({ paId, from, to: b, side });
      seen.add(paId);
    }
    // the batter
    if (batterPa.scored) {
      journeys.push({ paId: batterPa.id, from: 0, to: 4, exit: 'score', side, batter: true });
    } else {
      const b = baseOf(after, batterPa.id);
      if (b) journeys.push({ paId: batterPa.id, from: 0, to: b, side, batter: true });
    }
    return { journeys, scoreBump: scored.length ? side : null };
  }

  async function animatePlan(plan) {
    if (!plan || !plan.journeys.length) { if (plan && plan.scoreBump) bumpScore(plan.scoreBump); return; }
    if (plan.scoreBump) bumpScore(plan.scoreBump);
    await Promise.all(plan.journeys.map((j, i) => journey(j, i * 70)));
  }
  async function journey(j, delay) {
    if (delay) await wait(delay);
    let el = tokenEls[j.paId];
    if (!el) {
      const r = j.exit === 'score' ? null : g.live.bases[j.to];
      const num = j.batter ? (playerById(paById(j.paId)?.batterId)?.num) : (r ? r.num : numFromPa(j.paId));
      el = makeToken(j.paId, j.from, j.side, num);
      await wait(40);
    }
    const from = +el.dataset.base;
    const to = j.to;
    if (to >= from) { for (let b = from + 1; b <= to; b++) { setCoord(el, b); await wait(STEP); } }
    else { for (let b = from - 1; b >= to; b--) { setCoord(el, b); await wait(STEP); } }
    if (to === from) await wait(60);
    if (j.exit === 'score') { el.classList.add('scoring'); await wait(260); el.remove(); delete tokenEls[j.paId]; }
    else if (j.exit === 'out') { el.classList.add('thrown-out'); await wait(260); el.remove(); delete tokenEls[j.paId]; }
  }
  function numFromPa(paId) { const pa = paById(paId); return pa ? (playerById(pa.batterId)?.num) : ''; }
  function bumpScore(side) {
    const el = $('#sb-' + side + '-runs');
    el.textContent = g.live.runs[side];
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  async function sweepTokens() {
    const els = Object.values(tokenEls);
    if (!els.length) return;
    els.forEach(el => { el.classList.add('thrown-out'); });
    await wait(240);
    els.forEach(el => el.remove());
    for (const k in tokenEls) delete tokenEls[k];
  }
  // rebuild tokens straight from state (after undo / half change / resume)
  function rebuildTokens() {
    clearTokens();
    for (const b of [1, 2, 3]) {
      const r = g.live.bases[b]; if (!r) continue;
      makeToken(r.paId, b, r.side, r.num);
    }
  }
  let resizeRAF;
  function onResize() { cancelAnimationFrame(resizeRAF); resizeRAF = requestAnimationFrame(drawField); }

  // ----- runner quick-action popover -----
  function openPop(paId, el) {
    popPaId = paId;
    const pop = $('#runner-pop');
    pop.style.left = el.style.left; pop.style.top = el.style.top;
    pop.innerHTML =
      `<button class="pop-btn" data-act="steal">Steal</button>` +
      `<button class="pop-btn" data-act="adv">+1</button>` +
      `<button class="pop-btn score" data-act="score">Score</button>` +
      `<button class="pop-btn out" data-act="out">Out</button>` +
      `<button class="pop-btn" data-act="back">−1</button>`;
    pop.classList.remove('hidden');
  }
  function hidePop() { popPaId = null; $('#runner-pop').classList.add('hidden'); }

  // animation queue so rapid taps don't collide
  function enqueue(fn) { animChain = animChain.then(fn).catch(e => console.error(e)); return animChain; }

  // =========================================================================
  //  RENDER — scoreboard, now batting, plays, box
  // =========================================================================
  function renderAll() { renderScorebar(); renderNowBatting(); renderPlays(); renderBox(); }

  function renderScorebar() {
    const lv = g.live, bs = battingSide();
    document.documentElement.style.setProperty('--turn', teamColor(bs));
    $('#brand-name').textContent = teamName('home');
    document.documentElement.style.setProperty('--home', g.meta.home.color);
    document.documentElement.style.setProperty('--away', g.meta.away.color);
    $('#sb-away-abbr').textContent = abbr(teamName('away'));
    $('#sb-home-abbr').textContent = abbr(teamName('home'));
    $('#sb-away-runs').textContent = lv.runs.away;
    $('#sb-home-runs').textContent = lv.runs.home;
    $('#sb-away').classList.toggle('batting', bs === 'away');
    $('#sb-home').classList.toggle('batting', bs === 'home');
    const arrow = lv.half === 'top' ? '▲' : '▼';
    $('#sb-half').textContent = `${arrow} ${ordinal(lv.inning)}`;
    $$('.out-dot').forEach(d => d.classList.toggle('on', +d.dataset.o <= lv.outs));
    $('#sb-outs-label').textContent = lv.outs === 1 ? '1 out' : `${lv.outs} out`;
    $('#scorebar').classList.toggle('hidden', !lv.started);
  }

  function renderNowBatting() {
    const b = currentBatter();
    $('#nb-eyebrow').textContent = `Now batting · ${teamName(battingSide())}`;
    $('#nb-jersey').textContent = b ? (b.num ? '#' + b.num : '·') : '—';
    $('#nb-name').textContent = b ? b.name : '—';
    $('#nb-pos').textContent = b && b.pos ? b.pos : '';
    const d = onDeck();
    $('#nb-deck').textContent = d ? `On deck: ${d.num ? '#' + d.num + ' ' : ''}${d.name}` : '';
  }

  function renderPlays() {
    const wrap = $('#plays');
    const lv = g.live;
    if (!lv.pas.length) { wrap.innerHTML = `<p class="empty">No plays yet — tap an outcome on the Game tab to start the log.</p>`; return; }
    // group by inning+half, newest first
    const groups = [];
    lv.pas.forEach(pa => {
      const key = pa.inning + (pa.side === 'away' ? 'T' : 'B');
      let grp = groups.find(x => x.key === key);
      if (!grp) { grp = { key, inning: pa.inning, side: pa.side, pas: [] }; groups.push(grp); }
      grp.pas.push(pa);
    });
    let html = '';
    groups.slice().reverse().forEach(grp => {
      const arrow = grp.side === 'away' ? '▲ Top' : '▼ Bot';
      const runsThis = grp.pas.filter(p => p.scored).length;
      html += `<div class="play-half"><div class="ph-label"><span>${arrow} ${ordinal(grp.inning)} · ${esc(teamName(grp.side))}</span>` +
        `<span class="ph-runs">${runsThis ? runsThis + (runsThis === 1 ? ' run' : ' runs') : ''}</span></div>`;
      grp.pas.slice().reverse().forEach(pa => {
        const pl = playerById(pa.batterId);
        const meta = R[pa.result];
        const rbi = pa.rbi ? `<span class="play-rbi">${pa.rbi} RBI</span>` : '';
        const scored = pa.scored ? ' <b>— scored</b>' : '';
        html += `<div class="play ${grp.side}"><span class="play-tag">${meta.tag}</span>` +
          `<span class="play-text"><span class="play-jersey">${pl && pl.num ? '#' + esc(pl.num) + ' ' : ''}</span>${esc(pl ? pl.name : '—')} — ${esc(meta.label)}${scored}</span>${rbi}</div>`;
      });
      html += `</div>`;
    });
    wrap.innerHTML = html;
    const first = wrap.querySelector('.play');
    if (first) first.classList.add('fresh');
  }

  function renderBox() {
    renderLinescore();
    renderBatting('away'); renderBatting('home');
    $('#box-away-title').textContent = `${teamName('away')} — batting`;
    $('#box-home-title').textContent = `${teamName('home')} — batting`;
  }
  function renderLinescore() {
    const lv = g.live;
    const innings = Math.max(lv.inning, 1);
    const rbi = { away: {}, home: {} }, hbi = { away: {}, home: {} }, ebi = { away: {}, home: {} };
    lv.pas.forEach(pa => {
      const meta = R[pa.result];
      if (pa.scored) rbi[pa.side][pa.inning] = (rbi[pa.side][pa.inning] || 0) + 1;
      if (meta.hit) hbi[pa.side][pa.inning] = (hbi[pa.side][pa.inning] || 0) + 1;
      if (meta.roe) { const f = pa.side === 'away' ? 'home' : 'away'; ebi[f][pa.inning] = (ebi[f][pa.inning] || 0) + 1; }
    });
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    let head = '<thead><tr><th class="team"></th>';
    for (let i = 1; i <= innings; i++) head += `<th>${i}</th>`;
    head += '<th class="tot">R</th><th class="tot">H</th><th class="tot">E</th></tr></thead>';
    let body = '<tbody>';
    ['away', 'home'].forEach(side => {
      body += `<tr class="${side}"><td class="team">${esc(abbr(teamName(side)))}</td>`;
      for (let i = 1; i <= innings; i++) {
        const isFuture = (side === 'home' && i === lv.inning && lv.half === 'top');
        body += `<td>${isFuture ? '·' : (rbi[side][i] || 0)}</td>`;
      }
      body += `<td class="tot">${lv.runs[side]}</td><td class="tot">${sum(hbi[side])}</td><td class="tot">${sum(ebi[side])}</td></tr>`;
    });
    body += '</tbody>';
    $('#linescore').innerHTML = head + body;
  }
  function renderBatting(side) {
    const lu = g.teams[side];
    const stat = {};
    lu.forEach(p => stat[p.id] = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 });
    g.live.pas.forEach(pa => {
      if (pa.side !== side) return; const s = stat[pa.batterId]; if (!s) return;
      const m = R[pa.result];
      if (m.ab) s.ab++; if (m.hit) s.h++; if (m.bb) s.bb++; if (m.so) s.so++;
      if (pa.scored) s.r++; s.rbi += pa.rbi || 0;
    });
    let html = '<thead><tr><th class="player">Batter</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th></tr></thead><tbody>';
    const tot = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };
    lu.forEach(p => {
      const s = stat[p.id];
      ['ab', 'r', 'h', 'rbi', 'bb', 'so'].forEach(k => tot[k] += s[k]);
      html += `<tr><td class="player"><span class="pjersey">${p.num ? '#' + esc(p.num) : ''}</span>${esc(p.name)}</td>` +
        `<td>${s.ab}</td><td>${s.r}</td><td>${s.h}</td><td>${s.rbi}</td><td>${s.bb}</td><td>${s.so}</td></tr>`;
    });
    html += '</tbody><tfoot><tr><td class="player">Totals</td>' +
      `<td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.bb}</td><td>${tot.so}</td></tr></tfoot>`;
    $('#box-' + side).innerHTML = html;
  }

  // =========================================================================
  //  NAV / MENU / IO
  // =========================================================================
  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + name));
    $$('.nav-btn').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    $('#scorebar').classList.toggle('hidden', name === 'setup' || !g.live.started);
    if (name === 'setup') { fillMeta(); renderLineup(); }
    if (name === 'game') { requestAnimationFrame(() => { drawField(); rebuildTokens(); }); }
    if (name === 'box') renderBox();
    if (name === 'plays') renderPlays();
    hidePop();
  }
  function openSheet() { $('#backdrop').classList.remove('hidden'); $('#menu-sheet').classList.remove('hidden'); }
  function closeSheet() { $('#backdrop').classList.add('hidden'); $('#menu-sheet').classList.add('hidden'); }

  function newGame() {
    const keep = { teams: clone(g.teams), meta: clone(g.meta) };
    g = blankGame(); g.teams = keep.teams; g.meta = keep.meta;
    undoStack.length = 0; save(); clearTokens();
    fillMeta(); showView('setup'); renderAll(); toast('New game — rosters kept');
  }
  function resetAll() {
    if (!confirm('Erase the current game and saved rosters?')) return;
    try { localStorage.removeItem(STORE); localStorage.removeItem(ROSTER.away); localStorage.removeItem(ROSTER.home); } catch (e) {}
    g = blankGame(); undoStack.length = 0; clearTokens();
    fillMeta(); showView('setup'); renderAll(); toast('Reset complete');
  }
  function exportGame() {
    try {
      const blob = new Blob([JSON.stringify(g, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pbp-${(teamName('home') + '-vs-' + teamName('away')).replace(/\s+/g, '_')}-${g.meta.date || 'game'}.json`;
      a.click(); URL.revokeObjectURL(a.href); toast('Game exported');
    } catch (e) { toast('Could not export'); }
  }
  function importGame(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        if (!data.teams || !data.live) throw new Error('bad');
        g = data; save(); clearTokens();
        fillMeta(); showView(g.live.started ? 'game' : 'setup'); renderAll(); rebuildTokens();
        toast('Game imported');
      } catch (e) { toast('Could not read that file'); }
    };
    fr.readAsText(file);
  }

  // ---------- tiny utils ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function abbr(name) { const w = name.trim().split(/\s+/); if (w.length === 1) return w[0].slice(0, 3).toUpperCase(); return w.map(x => x[0]).join('').slice(0, 3).toUpperCase(); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // =========================================================================
  //  WIRE UP
  // =========================================================================
  function init() {
    load();
    canvas = $('#field'); ctx = canvas.getContext('2d'); stage = $('.stage-wrap');

    fillMeta();
    showView(g.live.started ? 'game' : 'setup');
    renderAll();
    if (g.live.started) rebuildTokens();

    // setup
    $('#btn-add').addEventListener('click', addPlayer);
    $('#np-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    $('#np-num').addEventListener('keydown', e => { if (e.key === 'Enter') $('#np-name').focus(); });
    $('#btn-fill9').addEventListener('click', fill9);
    $('#btn-save-roster').addEventListener('click', saveRoster);
    $('#btn-load-roster').addEventListener('click', loadRoster);
    $('#btn-start').addEventListener('click', startGame);
    $$('.team-tab').forEach(t => t.addEventListener('click', () => switchEditTeam(t.dataset.team)));
    switchEditTeam(editTeam);
    $('#lineup-list').addEventListener('click', e => {
      const up = e.target.dataset.up, down = e.target.dataset.down, del = e.target.dataset.del;
      if (up) moveRow(up, -1); else if (down) moveRow(down, 1); else if (del) delRow(del);
    });
    ['#f-date', '#f-place', '#f-mercy', '#f-away', '#f-home', '#f-away-color', '#f-home-color'].forEach(s =>
      $(s).addEventListener('change', () => { readMeta(); save(); renderScorebar(); renderLineup(); }));

    // outcomes
    $$('.oc[data-result]').forEach(btn => btn.addEventListener('click', () => applyOutcome(btn.dataset.result)));
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-endhalf').addEventListener('click', () => {
      if (!g.live.started) return;
      snapshot();
      enqueue(async () => { await sweepTokens(); endHalf(true); renderAll(); });
      toast('Half inning ended');
    });

    // runner popover
    $('#runner-pop').addEventListener('click', e => { const a = e.target.dataset.act; if (a && popPaId) runnerAction(popPaId, a); });
    $('.stage-wrap').addEventListener('click', () => hidePop());

    // nav
    $$('.nav-btn').forEach(n => n.addEventListener('click', () => showView(n.dataset.view)));

    // menu
    $('#btn-menu').addEventListener('click', openSheet);
    $('#backdrop').addEventListener('click', closeSheet);
    $$('#menu-sheet .sheet-item').forEach(it => it.addEventListener('click', () => {
      const a = it.dataset.action; closeSheet();
      if (a === 'new') newGame();
      else if (a === 'export') exportGame();
      else if (a === 'import') $('#import-file').click();
      else if (a === 'reset') resetAll();
    }));
    $('#import-file').addEventListener('change', e => { if (e.target.files[0]) importGame(e.target.files[0]); });

    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(stage);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
