/* ===========================================================================
   Bloordale 10U A · Scorekeeper
   A dead-simple, tap-driven digital baseball scorecard.
   Tracks OUR offense play-by-play (the paper scorecard), opponent runs for the
   scoreboard, and produces a live box score. Vanilla JS, no build, localStorage.
   =========================================================================== */
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const STORE = 'bloordale-scorekeeper-v1';
  const ROSTER = 'bloordale-roster-v1';

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1900);
  }

  // ---------- result definitions ----------
  // reach: base the batter lands on (4 = scores). adv: bases existing runners
  // auto-advance on a hit. forced: walk-style forced push only.
  const R = {
    '1B':  { label: 'Single',        hit: true,  ab: true,  reach: 1, adv: 1 },
    '2B':  { label: 'Double',        hit: true,  ab: true,  reach: 2, adv: 2 },
    '3B':  { label: 'Triple',        hit: true,  ab: true,  reach: 3, adv: 3 },
    'HR':  { label: 'Home Run',      hit: true,  ab: true,  reach: 4, adv: 4 },
    'BB':  { label: 'Walk',          hit: false, ab: false, reach: 1, forced: true, bb: true },
    'HBP': { label: 'Hit by pitch',  hit: false, ab: false, reach: 1, forced: true, hbp: true },
    'ROE': { label: 'Reached on error', hit: false, ab: true, reach: 1, adv: 1, noRbi: true },
    'FC':  { label: "Fielder's choice", hit: false, ab: true, reach: 1, forced: true },
    'K':   { label: 'Strikeout',     hit: false, ab: true,  out: true, so: true },
    'GO':  { label: 'Ground out',    hit: false, ab: true,  out: true },
    'FO':  { label: 'Fly out',       hit: false, ab: true,  out: true },
    'PO':  { label: 'Pop/Line out',  hit: false, ab: true,  out: true },
    'SAC': { label: 'Sacrifice',     hit: false, ab: false, out: true, sac: true, adv: 1 },
    'FO2': { label: 'Out',           hit: false, ab: true,  out: true },
  };
  // short tag drawn in scorecard cell
  const TAG = { '1B':'1B','2B':'2B','3B':'3B','HR':'HR','BB':'BB','HBP':'HP','ROE':'E','FC':'FC',
                'K':'K','GO':'GO','FO':'F','PO':'P','SAC':'SAC','FO2':'OUT' };

  // ---------- state ----------
  let g;
  const history = []; // undo snapshots of g.live

  function blankLive() {
    return {
      started: false,
      inning: 1,
      half: 'top',           // 'top' | 'bottom'
      outs: 0,
      batterIdx: 0,
      bases: [null, null, null, null], // 1=1B,2=2B,3=3B; runner = {paId}
      pas: [],               // our plate appearances
      oppRunsByInning: {},   // {inningNo: runs}
      lobByInning: {},
      errByPlayer: {},
      selectedBase: null,
    };
  }
  function blankGame() {
    return {
      meta: { date: '', place: '', away: 'Visitors', home: 'Bloordale', ourside: 'home' },
      lineup: [],
      pitchers: [{ no: '', name: 'Opp pitcher', w:'',l:'',ip:'',ab:'',r:'',er:'',h:'',so:'',bb:'' }],
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
  function snapshot() {
    history.push(clone(g.live));
    if (history.length > 60) history.shift();
  }

  // ---------- lineup helpers ----------
  const L = () => g.lineup;
  const currentBatter = () => L().length ? L()[g.live.batterIdx % L().length] : null;
  const playerById = (id) => L().find(p => p.id === id);
  const paById = (id) => g.live.pas.find(p => p.id === id);

  function isOurTurn() {
    const s = g.meta.ourside;
    return (s === 'away' && g.live.half === 'top') || (s === 'home' && g.live.half === 'bottom');
  }

  // =========================================================================
  //  SETUP — lineup editing
  // =========================================================================
  function addPlayer() {
    const num = $('#np-num').value.trim();
    const name = $('#np-name').value.trim();
    const pos = $('#np-pos').value;
    if (!name) { toast('Enter a player name'); return; }
    L().push({ id: uid(), num, name, pos });
    $('#np-num').value = ''; $('#np-name').value = ''; $('#np-pos').value = '';
    $('#np-name').focus();
    save(); renderLineup();
  }
  function removePlayer(id) {
    g.lineup = L().filter(p => p.id !== id);
    save(); renderLineup();
  }

  function renderLineup() {
    const ol = $('#lineup-list');
    ol.innerHTML = '';
    L().forEach((p, i) => {
      const li = document.createElement('li');
      li.dataset.id = p.id;
      li.innerHTML =
        `<span class="handle" title="Drag to reorder">⠿</span>` +
        `<span class="ord">${i + 1}</span>` +
        `<span class="pnum">${p.num ? '#' + p.num : ''}</span>` +
        `<span class="pname">${escapeHtml(p.name)}</span>` +
        (p.pos ? `<span class="ppos">${p.pos}</span>` : '') +
        `<button class="del" aria-label="Remove">×</button>`;
      li.querySelector('.del').addEventListener('click', () => removePlayer(p.id));
      attachDrag(li);
      ol.appendChild(li);
    });
  }

  // pointer-based drag reorder (works on touch + mouse)
  let dragLi = null;
  function attachDrag(li) {
    const handle = li.querySelector('.handle');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragLi = li; li.classList.add('dragging');
      const move = (ev) => {
        const y = ev.clientY;
        const sibs = $$('#lineup-list li').filter(x => x !== dragLi);
        for (const s of sibs) {
          const r = s.getBoundingClientRect();
          if (y < r.top + r.height / 2) { s.parentNode.insertBefore(dragLi, s); return; }
        }
        $('#lineup-list').appendChild(dragLi);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        li.classList.remove('dragging');
        // commit new order
        const ids = $$('#lineup-list li').map(x => x.dataset.id);
        g.lineup = ids.map(id => L().find(p => p.id === id));
        dragLi = null;
        save(); renderLineup();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function saveRoster() {
    if (!L().length) { toast('Nothing to save'); return; }
    try { localStorage.setItem(ROSTER, JSON.stringify(L())); toast('Roster saved'); } catch (e) {}
  }
  function loadRoster() {
    try {
      const raw = localStorage.getItem(ROSTER);
      if (!raw) { toast('No saved roster'); return; }
      g.lineup = JSON.parse(raw).map(p => ({ ...p, id: p.id || uid() }));
      save(); renderLineup(); toast('Roster loaded');
    } catch (e) { toast('Could not load roster'); }
  }

  // =========================================================================
  //  GAME CONTROL
  // =========================================================================
  function readMeta() {
    g.meta.date = $('#f-date').value;
    g.meta.place = $('#f-place').value.trim();
    g.meta.away = $('#f-away').value.trim() || 'Away';
    g.meta.home = $('#f-home').value.trim() || 'Home';
    g.meta.ourside = $('#f-ourside').value;
  }
  function fillMeta() {
    $('#f-date').value = g.meta.date || new Date().toISOString().slice(0, 10);
    $('#f-place').value = g.meta.place;
    $('#f-away').value = g.meta.away;
    $('#f-home').value = g.meta.home;
    $('#f-ourside').value = g.meta.ourside;
  }

  function startGame() {
    readMeta();
    if (!L().length) { toast('Add at least one batter'); return; }
    g.live = blankLive();
    g.live.started = true;
    history.length = 0;
    save();
    switchTab('score');
    renderAll();
    toast('Play ball! ⚾');
  }

  function endHalf() {
    const lv = g.live;
    if (isOurTurn()) {
      // left on base = runners still on
      const lob = [1, 2, 3].filter(b => lv.bases[b]).length;
      lv.lobByInning[lv.inning] = (lv.lobByInning[lv.inning] || 0) + lob;
    }
    lv.bases = [null, null, null, null];
    lv.outs = 0;
    lv.selectedBase = null;
    if (lv.half === 'top') { lv.half = 'bottom'; }
    else { lv.half = 'top'; lv.inning += 1; }
    save();
  }

  // ---------- core: apply a batting outcome ----------
  function applyOutcome(code) {
    const meta = R[code];
    if (!meta || !isOurTurn()) return;
    const batter = currentBatter();
    if (!batter) return;
    snapshot();
    const lv = g.live;

    const pa = {
      id: uid(), inning: lv.inning, batterId: batter.id, order: lv.batterIdx % L().length,
      result: code, rbi: 0, reached: 0, finalBase: 0, scored: false, outOnBase: false, sb: 0,
    };

    let runs = 0;
    if (meta.out) {
      lv.outs += 1;
      if (meta.adv) runs += advanceRunners(meta.adv, false); // sac advances runners
    } else {
      runs += placeBatter(pa, meta);
    }
    if (!meta.noRbi && (meta.hit || meta.forced || meta.sac)) pa.rbi = runs;

    lv.pas.push(pa);
    lv.batterIdx = (lv.batterIdx + 1) % Math.max(L().length, 1);

    let msg = `${batter.num ? '#' + batter.num + ' ' : ''}${batter.name}: ${meta.label}`;
    if (runs) msg += ` · ${runs} run${runs > 1 ? 's' : ''}`;

    if (lv.outs >= 3) { endHalf(); msg += ' · side retired'; }
    save(); renderAll(); toast(msg);
  }

  // advance existing runners by n bases (hits) or forced (walks). returns runs scored.
  function advanceRunners(n, forced) {
    const lv = g.live;
    let runs = 0;
    for (let b = 3; b >= 1; b--) {
      const r = lv.bases[b];
      if (!r) continue;
      let target = forced ? (isForced(b) ? b + 1 : b) : b + n;
      if (target === b) continue;
      lv.bases[b] = null;
      if (target >= 4) { const rpa = paById(r.paId); if (rpa) { rpa.finalBase = 4; rpa.scored = true; } runs++; }
      else { lv.bases[target] = r; const rpa = paById(r.paId); if (rpa) rpa.finalBase = target; }
    }
    return runs;
  }
  function isForced(b) {
    const bs = g.live.bases;
    if (b === 1) return true;          // batter forces runner on 1st
    if (b === 2) return !!bs[1];
    if (b === 3) return !!bs[1] && !!bs[2];
    return false;
  }

  function placeBatter(pa, meta) {
    const lv = g.live;
    let runs = advanceRunners(meta.adv || 1, !!meta.forced);
    if (meta.reach >= 4) { pa.finalBase = 4; pa.scored = true; runs++; } // HR
    else { lv.bases[meta.reach] = { paId: pa.id }; pa.reached = meta.reach; pa.finalBase = meta.reach; }
    return runs;
  }

  // ---------- runner adjustments (steals, extra bases, base outs) ----------
  function runnerAction(action) {
    const lv = g.live;
    const b = lv.selectedBase;
    const r = b && lv.bases[b];
    if (!r) { closeSheets(); return; }
    snapshot();
    const rpa = paById(r.paId);

    if (action === 'out') {
      lv.bases[b] = null;
      if (rpa) rpa.outOnBase = true;
      lv.outs += 1;
      if (lv.outs >= 3) { endHalf(); toast('Out on bases · side retired'); }
      else toast('Out on the bases');
    } else if (action === 'home' || action === 'steal-home') {
      lv.bases[b] = null;
      if (rpa) { rpa.finalBase = 4; rpa.scored = true; if (action === 'steal-home') rpa.sb = (rpa.sb || 0) + 1; }
      toast('Run scored! 🏠');
    } else if (action === '1' || action === 'steal') {
      const t = b + 1;
      if (t >= 4) { lv.bases[b] = null; if (rpa) { rpa.finalBase = 4; rpa.scored = true; } toast('Run scored! 🏠'); }
      else if (lv.bases[t]) { history.pop(); toast('Next base is occupied'); closeSheets(); return; }
      else { lv.bases[b] = null; lv.bases[t] = r; if (rpa) rpa.finalBase = t; toast(action === 'steal' ? 'Stolen base' : 'Runner advanced'); }
      if (action === 'steal' && rpa) rpa.sb = (rpa.sb || 0) + 1;
    } else if (action === 'back') {
      const t = b - 1;
      if (t < 1 || lv.bases[t]) { history.pop(); closeSheets(); return; }
      lv.bases[b] = null; lv.bases[t] = r; if (rpa) rpa.finalBase = t;
    }
    lv.selectedBase = null;
    closeSheets();
    save(); renderAll();
  }

  function undo() {
    if (!history.length) { toast('Nothing to undo'); return; }
    g.live = history.pop();
    save(); renderAll(); toast('Undid last play');
  }

  // ---------- defense (opponent batting) ----------
  function oppRun() {
    snapshot();
    const i = g.live.inning;
    g.live.oppRunsByInning[i] = (g.live.oppRunsByInning[i] || 0) + 1;
    save(); renderAll(); toast('Opponent run');
  }
  function oppOut() {
    snapshot();
    g.live.outs += 1;
    if (g.live.outs >= 3) { endHalf(); toast('3 outs — our at-bat'); }
    else toast(`Out (${g.live.outs}/3)`);
    save(); renderAll();
  }

  // =========================================================================
  //  RENDER
  // =========================================================================
  function renderAll() {
    renderScoreboard();
    renderScore();
    renderCard();
    renderStats();
  }

  function totals() {
    const our = g.live.pas.filter(p => p.scored).length;
    const opp = Object.values(g.live.oppRunsByInning).reduce((a, b) => a + b, 0);
    return { our, opp };
  }

  function renderScoreboard() {
    const sb = $('#scoreboard');
    if (!g.live.started) { sb.classList.add('hidden'); return; }
    const t = totals();
    const awayRuns = g.meta.ourside === 'away' ? t.our : t.opp;
    const homeRuns = g.meta.ourside === 'home' ? t.our : t.opp;
    $('#sb-away .sb-name').textContent = g.meta.away;
    $('#sb-home .sb-name').textContent = g.meta.home;
    $('#sb-away .sb-runs').textContent = awayRuns;
    $('#sb-home .sb-runs').textContent = homeRuns;
    const battingHome = g.live.half === 'bottom';
    $('#sb-away').classList.toggle('atbat', !battingHome);
    $('#sb-home').classList.toggle('atbat', battingHome);
    $('#sb-inning').textContent = (g.live.half === 'top' ? '▲ Top ' : '▼ Bot ') + g.live.inning;
    $('#sb-outs').textContent = g.live.outs + ' out';
  }

  function renderScore() {
    const tab = $('#tab-score');
    const offense = ['.now-batting', '.diamond-wrap', '#outcomes'];
    let dp = $('#defense-panel');

    if (!g.live.started) {
      offense.forEach(s => $(s).classList.add('hidden'));
      if (dp) dp.classList.add('hidden');
      if (!$('#score-empty')) {
        const e = document.createElement('div');
        e.id = 'score-empty'; e.className = 'panel center';
        e.innerHTML = '<p class="hint" style="margin:0">No game yet. Build your lineup in <b>Setup</b> and tap <b>Start game</b>.</p>';
        tab.prepend(e);
      }
      return;
    }
    const empty = $('#score-empty'); if (empty) empty.remove();

    if (isOurTurn()) {
      offense.forEach(s => $(s).classList.remove('hidden'));
      if (dp) dp.classList.add('hidden');
      renderNowBatting();
      renderDiamond();
    } else {
      offense.forEach(s => $(s).classList.add('hidden'));
      renderDefense();
    }
  }

  function renderNowBatting() {
    const b = currentBatter();
    if (!b) return;
    $('#nb-num').textContent = b.num ? '#' + b.num : '#—';
    $('#nb-name').textContent = b.name;
    $('#nb-pos').textContent = b.pos || '';
    $('#nb-pos').style.display = b.pos ? '' : 'none';
    const onBase = [1, 2, 3].filter(x => g.live.bases[x]).length;
    const ord = (g.live.batterIdx % L().length) + 1;
    $('#nb-order').textContent = `${ordinal(ord)} in order · ${onBase} on · ${g.live.outs} out`;
  }

  function renderDiamond() {
    const bs = g.live.bases;
    [1, 2, 3].forEach(b => {
      const el = $('.base-' + b);
      const occ = !!bs[b];
      el.classList.toggle('occupied', occ);
      // label
      let lbl = el.querySelector('.runner-label');
      if (occ) {
        const pa = paById(bs[b].paId);
        const pl = pa && playerById(pa.batterId);
        const text = pl ? (pl.num ? '#' + pl.num : pl.name.split(' ')[0]) : '';
        if (!lbl) { lbl = document.createElement('span'); lbl.className = 'runner-label'; el.appendChild(lbl); }
        lbl.textContent = text;
      } else if (lbl) { lbl.remove(); }
    });
    const anyOn = [1, 2, 3].some(b => bs[b]);
    $('#runner-tip').textContent = anyOn ? 'Tap a runner to advance, steal, or call out' : 'Bases empty';
  }

  function renderDefense() {
    const tab = $('#tab-score');
    let dp = $('#defense-panel');
    if (!dp) {
      dp = document.createElement('div');
      dp.id = 'defense-panel'; dp.className = 'panel center';
      tab.prepend(dp);
    }
    dp.classList.remove('hidden');
    const oppName = g.meta.ourside === 'home' ? g.meta.away : g.meta.home;
    const runsThis = g.live.oppRunsByInning[g.live.inning] || 0;
    dp.innerHTML =
      `<h2 style="margin-bottom:6px">On defense</h2>` +
      `<p class="hint" style="margin-bottom:14px"><b>${escapeHtml(oppName)}</b> batting · ${g.live.outs} out · ${runsThis} run${runsThis !== 1 ? 's' : ''} this inning</p>` +
      `<div class="og-buttons" style="grid-template-columns:1fr 1fr">` +
        `<button class="oc hit" id="d-run" style="background:#fdecec;color:var(--red);border-color:#f3c2c2">+1 Run allowed</button>` +
        `<button class="oc out" id="d-out">Out (${g.live.outs}/3)</button>` +
      `</div>` +
      `<button class="ghost-btn" id="d-undo" style="margin-top:10px">↶ Undo</button>`;
    $('#d-run').addEventListener('click', oppRun);
    $('#d-out').addEventListener('click', oppOut);
    $('#d-undo').addEventListener('click', undo);
  }

  // ---------- mini scorecard diamond (SVG) ----------
  function paMini(pa) {
    const pts = { 0: [50, 90], 1: [90, 50], 2: [50, 10], 3: [10, 50], 4: [50, 90] };
    let path = '';
    const fb = pa.finalBase;
    const seg = (a, b) => `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}" stroke="#c8102e" stroke-width="4" stroke-linecap="round"/>`;
    if (fb >= 1) path += seg(0, 1);
    if (fb >= 2) path += seg(1, 2);
    if (fb >= 3) path += seg(2, 3);
    if (fb >= 4) path += `<line x1="10" y1="50" x2="50" y2="90" stroke="#c8102e" stroke-width="4" stroke-linecap="round"/>`;
    const fill = pa.scored ? `<polygon points="50,86 86,50 50,14 14,50" fill="rgba(31,122,61,.18)" stroke="#1f7a3d" stroke-width="2"/>` : '';
    const out = pa.outOnBase ? `<circle cx="50" cy="50" r="5" fill="#0a0a0a"/>` : '';
    return `<div class="pa-mini">` +
      `<svg viewBox="0 0 100 100"><polygon points="50,90 90,50 50,10 10,50" fill="none" stroke="#c9ccd2" stroke-width="2"/>${fill}${path}${out}</svg>` +
      `<span class="pa-code">${TAG[pa.result] || ''}</span>` +
      (pa.rbi ? `<span class="pa-rbi">${pa.rbi}rbi</span>` : '') +
      (pa.sb ? `<span class="pa-out">${pa.sb}sb</span>` : '') +
      `</div>`;
  }

  function maxInning() {
    let m = 6;
    g.live.pas.forEach(p => { if (p.inning > m) m = p.inning; });
    Object.keys(g.live.oppRunsByInning).forEach(k => { if (+k > m) m = +k; });
    if (g.live.started) m = Math.max(m, g.live.inning);
    return Math.max(m, 6);
  }

  function renderCard() {
    const table = $('#scorecard');
    const innings = maxInning();
    const cols = [];
    for (let i = 1; i <= innings; i++) cols.push(i);

    let head = '<thead><tr><th class="col-name">Batter</th>';
    cols.forEach(i => head += `<th>${i}</th>`);
    head += '<th>AB</th><th>R</th><th>H</th><th>RBI</th><th>SO</th><th>BB</th><th>E</th><th>SB</th></tr></thead>';

    const st = deriveStats(innings);
    let body = '<tbody>';
    L().forEach(p => {
      const s = st.players[p.id];
      body += `<tr><td class="col-name"><span class="num">${p.num ? '#' + p.num : ''}</span>${escapeHtml(p.name)}${p.pos ? ' <small style="color:#888">' + p.pos + '</small>' : ''}</td>`;
      cols.forEach(i => {
        const cell = g.live.pas.filter(pa => pa.batterId === p.id && pa.inning === i);
        body += `<td class="pa-cell">${cell.map(paMini).join('')}</td>`;
      });
      body += `<td class="stat-cell">${s.ab}</td><td class="stat-cell">${s.r}</td><td class="stat-cell">${s.h}</td>` +
              `<td class="stat-cell">${s.rbi}</td><td class="stat-cell">${s.so}</td><td class="stat-cell">${s.bb}</td>` +
              `<td class="stat-cell">${s.e}</td><td class="stat-cell">${s.sb}</td></tr>`;
    });
    body += '</tbody>';

    // footer R/H/E/LOB per inning
    const rows = [['R', 'r'], ['H', 'h'], ['E', 'e'], ['LOB', 'lob']];
    let foot = '<tfoot>';
    rows.forEach(([lbl, key]) => {
      foot += `<tr><td class="rowlbl">${lbl}</td>`;
      cols.forEach(i => foot += `<td>${st.inning[i][key] || 0}</td>`);
      foot += `<td colspan="8"></td></tr>`;
    });
    foot += '</tfoot>';

    table.innerHTML = head + body + foot;
  }

  function deriveStats(innings) {
    const players = {};
    L().forEach(p => players[p.id] = { ab:0,r:0,h:0,rbi:0,so:0,bb:0,hbp:0,e:(g.live.errByPlayer[p.id]||0),sb:0,pa:0 });
    const inning = {};
    for (let i = 1; i <= (innings || maxInning()); i++) inning[i] = { r:0,h:0,e:0,lob:(g.live.lobByInning[i]||0) };

    g.live.pas.forEach(pa => {
      const s = players[pa.batterId]; if (!s) return;
      const m = R[pa.result];
      s.pa++;
      if (m.ab) s.ab++;
      if (m.hit) { s.h++; if (inning[pa.inning]) inning[pa.inning].h++; }
      if (m.so) s.so++;
      if (m.bb) s.bb++;
      if (m.hbp) s.hbp++;
      s.rbi += pa.rbi || 0;
      s.sb += pa.sb || 0;
      if (pa.scored) { s.r++; if (inning[pa.inning]) inning[pa.inning].r++; }
    });
    return { players, inning };
  }

  function renderStats() {
    const innings = maxInning();
    const st = deriveStats(innings);

    // batting box
    let b = '<thead><tr><th class="name">Batter</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>SO</th><th>BB</th><th>E</th><th>SB</th></tr></thead><tbody>';
    const tot = { ab:0,r:0,h:0,rbi:0,so:0,bb:0,hbp:0,e:0,sb:0 };
    L().forEach(p => {
      const s = st.players[p.id];
      ['ab','r','h','rbi','so','bb','hbp','e','sb'].forEach(k => tot[k] += (s[k]||0));
      b += `<tr><td class="name"><span style="color:var(--red);font-weight:800">${p.num ? '#'+p.num+' ' : ''}</span>${escapeHtml(p.name)}</td>` +
        `<td>${s.ab}</td><td>${s.r}</td><td>${s.h}</td><td>${s.rbi}</td><td>${s.so}</td><td>${s.bb}</td>` +
        `<td><input class="stat-in" data-eid="${p.id}" inputmode="numeric" value="${s.e}"></td><td>${s.sb}</td></tr>`;
    });
    b += '</tbody><tfoot><tr><td class="name">TEAM</td>' +
      `<td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.so}</td>` +
      `<td>${tot.bb + tot.hbp}<small>bb/hp</small></td><td>${tot.e}</td><td>${tot.sb}</td></tr></tfoot>`;
    $('#box-batting').innerHTML = b;
    $$('#box-batting .stat-in').forEach(inp => inp.addEventListener('change', () => {
      g.live.errByPlayer[inp.dataset.eid] = parseInt(inp.value, 10) || 0; save(); renderCard();
    }));

    // by inning
    let ih = '<thead><tr><th class="name"></th>';
    for (let i = 1; i <= innings; i++) ih += `<th>${i}</th>`;
    ih += '<th>Tot</th></tr></thead><tbody>';
    [['Runs','r'],['Hits','h'],['LOB','lob']].forEach(([lbl,key]) => {
      let sum = 0; ih += `<tr><td class="name">${lbl}</td>`;
      for (let i = 1; i <= innings; i++) { const v = st.inning[i][key]||0; sum += v; ih += `<td>${v}</td>`; }
      ih += `<td><b>${sum}</b></td></tr>`;
    });
    // opponent runs row
    let oppSum = 0; ih += `<tr><td class="name">Opp R</td>`;
    for (let i = 1; i <= innings; i++) { const v = g.live.oppRunsByInning[i]||0; oppSum += v; ih += `<td>${v}</td>`; }
    ih += `<td><b>${oppSum}</b></td></tr></tbody>`;
    $('#box-inning').innerHTML = ih;

    // pitchers (editable)
    renderPitchers();
  }

  const PCOLS = [['no','#'],['name','Pitcher'],['w','W'],['l','L'],['ip','IP'],['ab','AB'],['r','R'],['er','ER'],['h','H'],['so','SO'],['bb','BB']];
  function renderPitchers() {
    let h = '<thead><tr>' + PCOLS.map(([k,l]) => `<th${k==='name'?' class="name"':''}>${l}</th>`).join('') + '</tr></thead><tbody>';
    g.pitchers.forEach((p, idx) => {
      h += '<tr>' + PCOLS.map(([k]) =>
        `<td${k==='name'?' class="name"':''}><input class="stat-in" style="width:${k==='name'?'110px':'42px'}" data-pi="${idx}" data-pk="${k}" value="${escapeHtml(String(p[k]||''))}"></td>`
      ).join('') + '</tr>';
    });
    h += '</tbody>';
    $('#box-pitchers').innerHTML = h;
    $$('#box-pitchers .stat-in').forEach(inp => inp.addEventListener('change', () => {
      g.pitchers[+inp.dataset.pi][inp.dataset.pk] = inp.value; save();
    }));
  }
  function addPitcher() {
    g.pitchers.push({ no:'',name:'Pitcher',w:'',l:'',ip:'',ab:'',r:'',er:'',h:'',so:'',bb:'' });
    save(); renderPitchers();
  }

  // =========================================================================
  //  NAV / SHEETS / IO
  // =========================================================================
  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.add('hidden'));
    $('#tab-' + name).classList.remove('hidden');
    $$('.nav-btn').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
    $('#scoreboard').classList.toggle('hidden', name === 'setup' || !g.live.started);
    if (name === 'setup') { fillMeta(); }
  }

  function openSheet(id) { $('#sheet-backdrop').classList.remove('hidden'); $(id).classList.remove('hidden'); }
  function closeSheets() {
    $('#sheet-backdrop').classList.add('hidden');
    $('#menu-sheet').classList.add('hidden');
    $('#runner-sheet').classList.add('hidden');
  }

  function exportGame() {
    const data = JSON.stringify(g, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = g.meta.date || new Date().toISOString().slice(0,10);
    a.download = `scorecard-${g.meta.home}-vs-${g.meta.away}-${d}.json`.replace(/\s+/g,'_');
    a.click(); URL.revokeObjectURL(a.href);
  }
  function importGame(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.lineup || !data.live) throw new Error('bad');
        g = data; history.length = 0; save();
        fillMeta(); renderLineup(); renderAll();
        switchTab(g.live.started ? 'score' : 'setup');
        toast('Game imported');
      } catch (e) { toast('Invalid game file'); }
    };
    reader.readAsText(file);
  }
  function newGame() {
    const keepLineup = L();
    g = blankGame(); g.lineup = keepLineup;
    history.length = 0; save();
    fillMeta(); renderLineup(); renderAll();
    switchTab('setup'); toast('New game — lineup kept');
  }
  function resetAll() {
    if (!confirm('Erase the current game AND saved roster?')) return;
    try { localStorage.removeItem(STORE); localStorage.removeItem(ROSTER); } catch (e) {}
    g = blankGame(); history.length = 0;
    fillMeta(); renderLineup(); renderAll(); switchTab('setup'); toast('Reset complete');
  }

  // ---------- misc ----------
  function ordinal(n) { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  // =========================================================================
  //  WIRE UP
  // =========================================================================
  function init() {
    load();
    fillMeta();
    renderLineup();
    renderAll();
    switchTab(g.live.started ? 'score' : 'setup');
    if (g.live.started) $('#btn-resume').classList.remove('hidden');

    // setup
    $('#btn-add-player').addEventListener('click', addPlayer);
    $('#np-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    $('#btn-save-roster').addEventListener('click', saveRoster);
    $('#btn-load-roster').addEventListener('click', loadRoster);
    $('#btn-start').addEventListener('click', startGame);
    $('#btn-resume').addEventListener('click', () => switchTab('score'));
    ['#f-date','#f-place','#f-away','#f-home','#f-ourside'].forEach(s =>
      $(s).addEventListener('change', () => { readMeta(); save(); renderScoreboard(); }));

    // outcomes
    $$('#outcomes .oc[data-result]').forEach(btn =>
      btn.addEventListener('click', () => applyOutcome(btn.dataset.result)));
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-endhalf').addEventListener('click', () => {
      if (!g.live.started) return; snapshot(); endHalf(); renderAll(); toast('Half inning ended');
    });

    // diamond bases
    [1,2,3].forEach(b => $('.base-' + b).addEventListener('click', () => {
      if (!g.live.bases[b]) return;
      g.live.selectedBase = b;
      const pa = paById(g.live.bases[b].paId);
      const pl = pa && playerById(pa.batterId);
      $('#rs-title').textContent = pl ? `${pl.num ? '#'+pl.num+' ' : ''}${pl.name} on ${b===1?'1st':b===2?'2nd':'3rd'}` : 'Runner';
      openSheet('#runner-sheet');
    }));
    $$('#runner-sheet [data-radv]').forEach(btn => btn.addEventListener('click', () => {
      const a = btn.dataset.radv;
      if (a === 'close') { closeSheets(); return; }
      runnerAction(a);
    }));
    // add a steal option dynamically isn't needed; map existing: advance=1, etc.

    // stats
    $('#btn-add-pitcher').addEventListener('click', addPitcher);

    // bottom nav
    $$('.nav-btn').forEach(n => n.addEventListener('click', () => switchTab(n.dataset.tab)));

    // menu
    $('#btn-menu').addEventListener('click', () => openSheet('#menu-sheet'));
    $('#sheet-backdrop').addEventListener('click', closeSheets);
    $$('#menu-sheet .sheet-item').forEach(it => it.addEventListener('click', () => {
      const a = it.dataset.action;
      closeSheets();
      if (a === 'new') newGame();
      else if (a === 'export') exportGame();
      else if (a === 'import') $('#import-file').click();
      else if (a === 'print') { switchTab('card'); setTimeout(() => window.print(), 250); }
      else if (a === 'reset') resetAll();
    }));
    $('#import-file').addEventListener('change', e => { if (e.target.files[0]) importGame(e.target.files[0]); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
