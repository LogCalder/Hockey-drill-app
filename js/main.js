/* UI wiring: palette, tools, inspector, drill strip, file save/open, export dialog. */
(function (HD) {
  'use strict';
  const S = HD.store, E = HD.editor;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const PLAYER_LABELS = ['X', 'O', 'F', 'D', 'LW', 'C', 'RW', 'LD', 'RD', 'G'];
  const COLORS = ['#111111', '#e03131', '#1c6fe0', '#2f9e44', '#f08c00', '#7048e8', '#ffffff'];

  // Tiny canvas previews drawn with the real renderer, so palette icons match the ice exactly.
  function icon(canvas, w, h, draw) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    draw(c);
  }
  const mkLine = (kind, pts) => ({ type: 'line', kind, color: '#111', pts });

  function buildPalette() {
    // tools
    const lineIcons = {
      skate: mkLine('skate', [{ x: 6, y: 40 }, { x: 66, y: 10 }]),
      back: mkLine('back', [{ x: 6, y: 40 }, { x: 66, y: 10 }]),
      pass: mkLine('pass', [{ x: 6, y: 40 }, { x: 66, y: 10 }]),
      dump: mkLine('dump', [{ x: 6, y: 40 }, { x: 66, y: 10 }]),
      shoot: mkLine('shoot', [{ x: 6, y: 40 }, { x: 66, y: 10 }]),
    };
    $$('#tools button').forEach((b) => {
      const t = b.dataset.tool, cv = $('canvas', b);
      icon(cv, 72, 50, (c) => {
        c.scale(0.7, 0.7); c.translate(8, 6);
        if (lineIcons[t]) HD.R.drawObject(c, lineIcons[t]);
        else if (t === 'draw') {
          c.strokeStyle = '#111'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath();
          c.moveTo(10, 44); c.bezierCurveTo(24, 6, 40, 70, 56, 30); c.bezierCurveTo(62, 14, 70, 22, 74, 12); c.stroke();
        } else if (t === 'text') { c.font = '700 38px ' + HD.R.FONT; c.fillStyle = '#111'; c.textBaseline = 'middle'; c.fillText('Aa', 14, 26); }
        else { // cursor arrow
          c.fillStyle = '#111'; c.beginPath(); c.moveTo(34, 4); c.lineTo(34, 54); c.lineTo(46, 42); c.lineTo(56, 62); c.lineTo(64, 58); c.lineTo(54, 38); c.lineTo(70, 38); c.closePath(); c.fill();
        }
      });
      b.addEventListener('click', () => E.setTool(t));
    });

    // draggable items
    function draggable(el, kind, label, dragCanvas) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/hd-kind', kind);
        e.dataTransfer.setData('text/hd-label', label || '');
        e.dataTransfer.effectAllowed = 'copy';
        if (dragCanvas) e.dataTransfer.setDragImage(dragCanvas, dragCanvas.width / 2 / (window.devicePixelRatio || 1), dragCanvas.height / 2 / (window.devicePixelRatio || 1));
      });
      // click also drops one in the middle of the visible ice (handy on a trackpad)
      el.addEventListener('dblclick', () => {
        const d = S.current;
        E.place(kind, label, { x: HD.RINK.W / 2 + (Math.random() - .5) * 120, y: HD.RINK.heightOf(d.rink) / 2 + (Math.random() - .5) * 120 });
      });
    }

    const players = $('#players');
    PLAYER_LABELS.forEach((lab) => {
      const b = document.createElement('div'); b.className = 'chip'; b.title = 'Drag onto the ice (or double-click)';
      const cv = document.createElement('canvas'); b.appendChild(cv);
      icon(cv, 38, 38, (c) => { c.translate(19, 19); c.scale(0.55, 0.55); HD.R.drawObject(c, { type: 'player', x: 0, y: 0, label: lab, color: '#111111' }); });
      draggable(b, 'player', lab, cv);
      players.appendChild(b);
    });

    const pieces = $('#pieces');
    [
      ['puck', 'Puck', { type: 'puck', x: 0, y: 0, color: '#111' }, 2.6],
      ['cone', 'Cone', { type: 'cone', x: 0, y: 0, color: '#ff7a1a', rot: 0 }, 0.9],
      ['stick', 'Stick', { type: 'stick', x: 0, y: 0, color: '#6b4423', rot: 0 }, 0.62],
      ['net', 'Net', { type: 'net', x: 0, y: 0, color: '#c8102e', rot: 0 }, 0.56],
      ['coach', 'Coach', { type: 'player', x: 0, y: 0, label: '\u00a9', color: '#111111' }, 0.6],
    ].forEach(([kind, name, obj, sc]) => {
      const b = document.createElement('div'); b.className = 'piece'; b.title = 'Drag onto the ice (or double-click)';
      const cv = document.createElement('canvas'); b.appendChild(cv);
      const s = document.createElement('span'); s.textContent = name; b.appendChild(s);
      icon(cv, 48, 48, (c) => { c.translate(24, 24); c.scale(sc, sc); if (kind === 'stick') c.translate(-8, -4); HD.R.drawObject(c, obj); });
      draggable(b, kind, '', cv);
      pieces.appendChild(b);
    });

    // colors
    const sw = $('#swatches');
    COLORS.forEach((col) => {
      const b = document.createElement('button'); b.className = 'swatch'; b.style.setProperty('--c', col); b.dataset.color = col; b.title = col;
      b.addEventListener('click', () => { E.setColor(col); syncColor(); });
      sw.appendChild(b);
    });
  }

  function syncColor() { $$('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === E.color)); }

  const HINTS = {
    select: 'Click to select, drag to move. ⌫ deletes, R rotates.',
    skate: 'Drag on the ice to draw a skating path.',
    back: 'Drag on the ice to draw a backward-skating path.',
    pass: 'Drag on the ice to draw a pass.',
    dump: 'Drag on the ice to draw a dump: the puck just goes to open space.',
    shoot: 'Drag on the ice to draw a shot.',
    text: 'Click the ice and type. Double-click text to edit.',
    draw: 'Click and drag on the ice to draw freehand. Pick a color first.',
  };

  function syncTool() {
    $$('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === E.tool));
    $$('#lineMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === E.lineMode));
    const isLine = ['skate', 'back', 'pass', 'dump', 'shoot'].includes(E.tool);
    $('#lineMode').classList.toggle('dim', !isLine);
    $('#toolHint').textContent = isLine && E.lineMode === 'curve'
      ? 'Drag to draw, then drag the white middle handle to bend the path.'
      : HINTS[E.tool];
  }

  // ---------- inspector ----------
  const NAMES = { player: 'Player', puck: 'Puck', cone: 'Cone', stick: 'Stick', net: 'Net', text: 'Text', line: 'Line' };
  function syncSelection(o) {
    $('#selPanel').hidden = !o;
    syncAnimPanel(o);
    if (!o) return;
    $('#selTitle').textContent = o.type === 'line' ? { skate: 'Skating line', back: 'Backward skating', pass: 'Pass', dump: 'Dump', shoot: 'Shot', free: 'Pen drawing' }[o.kind] : (o.type === 'player' ? (o.label === '\u00a9' ? 'Coach' : 'Player ' + o.label) : NAMES[o.type]);
    const rot = o.type === 'cone' || o.type === 'stick' || o.type === 'net';
    $('#actRotL').hidden = $('#actRotR').hidden = !rot;
    if (o.type === 'line' && o.kind === 'free') { /* nothing extra */ }
    $('#sizeField').hidden = o.type !== 'text';
    if (o.type === 'text') $('#textSize').value = o.size;
  }

  function syncDrill() {
    const d = S.current;
    $('#drillName').value = d.name;
    $('#drillNotes').value = d.notes;
    $$('#rinkType button').forEach((b) => b.classList.toggle('on', b.dataset.rink === d.rink));
    $('#expCount').textContent = S.project.drills.length;
  }


  // ---------- animation ----------
  const An = HD.anim;
  const COLOR_NAMES = { '#111111': 'black', '#e03131': 'red', '#1c6fe0': 'blue', '#2f9e44': 'green', '#f08c00': 'orange', '#7048e8': 'purple', '#ffffff': 'white' };
  const describe = (o) => (o.type === 'puck' ? 'Puck' : (o.label === '©' ? 'Coach' : 'Player ' + o.label) + ' (' + (COLOR_NAMES[o.color] || 'custom') + ')');
  const isMotion = (o) => o && o.type === 'line' && o.kind !== 'free';
  const isShotLine = (o) => o.kind === 'pass' || o.kind === 'dump' || o.kind === 'shoot';

  function syncAnimPanel(o) {
    const show = E.animMode && isMotion(o);
    $('#animPanel').hidden = !show;
    if (!show) return;
    const a = o.anim || { step: 1, actors: [], carry: null };
    $('#subNum').textContent = String.fromCharCode(96 + Math.min(26, a.sub || 1));
    const shot = isShotLine(o);
    $('#animKind').textContent = { skate: 'skating', back: 'backward', pass: 'pass', dump: 'dump', shoot: 'shot' }[o.kind];
    $('#stepNum').textContent = a.step || 1;
    $('#actorLabel').textContent = shot ? 'Puck that travels' : 'Players that skate this';
    $('#btnPickActor').textContent = shot ? '+ Pick the puck' : '+ Pick a player / coach';
    $('#carryField').hidden = shot;
    $('#motionSpeed').value = a.speed || 1; $('#motionSpeedVal').textContent = (a.speed || 1).toFixed(1) + '×';
    $('#animHint').textContent = shot
      ? 'Passes, dumps and shots only attach to a puck. Within this step it goes once whoever has the puck reaches the start of this line. A pass is timed to arrive just before the player at the end gets there; a dump just goes to open space.'
      : 'Add one or more players. Pucks they have move with them automatically; picking a puck below just forces it.';
    const fill = (el, ids, onRemove) => {
      el.innerHTML = '';
      ids.forEach((id) => {
        const t = S.current.objects.find((x) => x.id === id); if (!t) return;
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = describe(t);
        const x = document.createElement('button'); x.textContent = '×'; x.title = 'Remove'; x.onclick = () => onRemove(id);
        tag.appendChild(x); el.appendChild(tag);
      });
    };
    fill($('#actorChips'), a.actors || [], (id) => editAnim(o, (an) => { an.actors = an.actors.filter((x) => x !== id); }));
    fill($('#carryChips'), a.carry ? [a.carry] : [], () => editAnim(o, (an) => { an.carry = null; }));
  }

  function editAnim(line, fn) {
    S.checkpoint();
    line.anim = line.anim || { step: 1, actors: [], carry: null };
    fn(line.anim);
    S.emit('objects');
  }

  function pickFor(role) {
    const line = E.getSelected();
    if (!isMotion(line)) return;
    const shot = isShotLine(line);
    E.startPick((t) => {
      if (role === 'actor') {
        if (shot && t.type !== 'puck') { toast('Passes and shots can only be attached to a puck'); return false; }
        if (!shot && t.type !== 'player') { toast('Skating motions move a player or the coach (use “Carrying a puck” for pucks)'); return false; }
        editAnim(line, (a) => { if (!a.actors.includes(t.id)) a.actors.push(t.id); });
      } else {
        if (t.type !== 'puck') { toast('Pick a puck'); return false; }
        editAnim(line, (a) => { a.carry = t.id; });
      }
      return true;
    });
  }

  // ----- step-by-step record -----
  function renderSteps() {
    const panel = $('#stepsPanel');
    panel.hidden = !E.animMode;
    if (!E.animMode) return;
    const info = An.describe(S.current), list = $('#stepList');
    list.innerHTML = '';
    $('#stepsInfo').textContent = info.steps.length ? info.steps.length + ' step' + (info.steps.length > 1 ? 's' : '') + ' · ' + info.total.toFixed(1) + 's' : '';
    if (!info.steps.length) list.innerHTML = '<p class="hint">Nothing attached yet. Select a motion line, then pick who moves. Each step will be listed here.</p>';
    info.steps.forEach((st, i) => {
      const card = document.createElement('div'); card.className = 'stepcard'; card.dataset.idx = i;
      card.innerHTML = '<header><span class="num"></span>Step<small></small></header><ul></ul>';
      $('.num', card).textContent = st.label; $('small', card).textContent = st.dur.toFixed(1) + 's';
      st.lines.forEach((t) => { const li = document.createElement('li'); li.textContent = t; $('ul', card).appendChild(li); });
      card.title = 'Click to jump to this step';
      card.onclick = () => { if (!An.tl && !startPreview(false)) return; An.playing = false; An.seek(An.tl.steps[i].start); };
      list.appendChild(card);
    });
    if (info.unattached) {
      const p = document.createElement('p'); p.className = 'hint';
      p.textContent = info.unattached + ' motion line' + (info.unattached > 1 ? 's have' : ' has') + ' nothing attached, so ' + (info.unattached > 1 ? 'they stay' : 'it stays') + ' still.';
      list.appendChild(p);
    }
  }
  function highlightStep() {
    const idx = An.tl ? An.stepAt() : -1;
    $$('.stepcard').forEach((c) => c.classList.toggle('active', +c.dataset.idx === idx));
  }

  // ----- play bar -----
  function fmt(t) { return t.toFixed(1) + 's'; }
  function frame() {
    const playing = An.playing;
    $('#pbPlay').textContent = playing ? '⏸' : '▶';
    if (!An.tl) { E.pose = null; E.redraw(); $('#pbScrub').value = 0; $('#pbTime').textContent = '0.0s'; $('#pbHint').textContent = ''; highlightStep(); return; }
    E.pose = An.pose();
    E.redraw();
    $('#pbScrub').value = Math.round((An.t / An.tl.total) * 1000);
    $('#pbTime').textContent = fmt(An.t) + ' / ' + fmt(An.tl.total);
    $('#pbHint').textContent = 'Preview - press ■ to edit again';
    highlightStep();
  }
  An.onFrame = frame;

  function drawMarks() {
    const m = $('#pbMarks'); m.innerHTML = '';
    if (!An.tl) return;
    An.tl.steps.forEach((st) => {
      const i = document.createElement('i'); i.textContent = st.label; i.style.left = (st.start / An.tl.total) * 100 + '%'; m.appendChild(i);
    });
  }

  function startPreview(autoPlay) {
    if (!An.hasMotions(S.current)) { toast('Select a motion line and attach a player first'); return false; }
    if (!An.tl) { An.begin(S.current); drawMarks(); }
    if (autoPlay) An.play(S.current); else frame();
    return true;
  }
  function stopPreview() { An.stop(); $('#pbMarks').innerHTML = ''; }


  // ----- video export: records the animation as it plays -----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let recording = false;

  function pickVideoType() {
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function exportVideo() {
    if (recording) return;
    const d = S.current;
    if (!An.hasMotions(d)) { setAnimMode(true); toast('Nothing to animate yet: select a line and pick who moves'); return; }
    if (typeof MediaRecorder === 'undefined' || !pickVideoType()) { toast('This browser cannot record video - use Chrome'); return; }
    // first video: ask where it should go (cancel = normal download)
    if (F.supported && F.states.exports !== 'ready') await connectExports();

    recording = true;
    const btns = [$('#pbExport'), $('#btnExportVideo')], banner = $('#recBanner');
    btns.forEach((b) => { b.disabled = true; });
    banner.hidden = false; banner.textContent = 'Recording video… 0%';
    stopPreview(); An.begin(d); drawMarks();
    const prevRate = An.rate; An.rate = 1;

    // offscreen canvas at a fixed, even-sized resolution (long edge up to 1280px)
    const H = HD.RINK.heightOf(d.rink), W = HD.RINK.W, k = Math.min(1.2, 1280 / H);
    const cv = document.createElement('canvas');
    cv.width = Math.round(W * k / 2) * 2; cv.height = Math.round(H * k / 2) * 2;
    const c = cv.getContext('2d');
    const paint = () => {
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      HD.R.drawDrill(c, d, { pose: An.pose(), dim: true });
    };

    const mime = pickVideoType(), ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise((res) => { rec.onstop = res; });

    paint();
    rec.start(250);
    const ticker = setInterval(() => {
      paint();
      if (An.tl) banner.textContent = 'Recording video… ' + Math.min(100, Math.round((An.t / An.tl.total) * 100)) + '%';
    }, 33);
    try {
      await sleep(500);                       // hold on the starting layout
      An.play(d);
      while (An.tl && (An.playing || An.t < An.tl.total)) await sleep(100);
      await sleep(900);                       // hold on the final layout
    } finally {
      clearInterval(ticker);
      rec.stop(); await finished;
      An.rate = prevRate; stopPreview(); banner.hidden = true;
      btns.forEach((b) => { b.disabled = false; }); recording = false;
    }
    const base = clean(d.name) || 'Drill';
    await deliverBlob(new Blob(chunks, { type: mime.split(';')[0] }), base + ' animation ' + today() + '.' + ext);
  }

  function setAnimMode(on) {
    E.animMode = on;
    $('#btnAnimate').classList.toggle('on', on);
    $('#playwrap').hidden = !on;
    if (!on) { stopPreview(); E.cancelPick(); } else E.setTool('select');
    $('#stage').classList.toggle('animating', on);
    syncSelection(E.getSelected());
    renderSteps();
    E.layout();
  }

  function initAnim() {
    $('#btnAnimate').onclick = () => setAnimMode(!E.animMode);
    $('#motionSpeed').onpointerdown = () => S.checkpoint();
    $('#motionSpeed').oninput = (e) => {
      const l = E.getSelected(); if (!isMotion(l)) return;
      l.anim = l.anim || { step: 1, actors: [], carry: null };
      l.anim.speed = +e.target.value; $('#motionSpeedVal').textContent = l.anim.speed.toFixed(1) + '×';
    };
    $('#motionSpeed').onchange = () => S.emit('objects');
    $('#btnPickActor').onclick = () => pickFor('actor');
    $('#btnPickCarry').onclick = () => pickFor('carry');
    $('#stepUp').onclick = () => { const l = E.getSelected(); editAnim(l, (a) => { a.step = (a.step || 1) + 1; }); };
    $('#subUp').onclick = () => { const l = E.getSelected(); editAnim(l, (a) => { a.sub = Math.min(26, (a.sub || 1) + 1); }); };
    $('#subDown').onclick = () => { const l = E.getSelected(); editAnim(l, (a) => { a.sub = Math.max(1, (a.sub || 1) - 1); }); };
    $('#stepDown').onclick = () => { const l = E.getSelected(); editAnim(l, (a) => { a.step = Math.max(1, (a.step || 1) - 1); }); };
    E.onPick = (on) => { $('#pickBanner').hidden = !on; };

    $('#pbPlay').onclick = () => {
      if (An.playing) { An.pause(); return; }
      if (!An.tl) { if (!startPreview(true)) return; } else An.play(S.current);
    };
    $('#pbStop').onclick = stopPreview;
    $('#pbExport').onclick = exportVideo;
    $('#btnExportVideo').onclick = exportVideo;
    $('#pbSpeed').onchange = (e) => { An.rate = +e.target.value; };
    $('#pbScrub').oninput = (e) => {
      if (!An.tl && !startPreview(false)) { e.target.value = 0; return; }
      An.playing = false; An.seek((+e.target.value / 1000) * An.tl.total);
    };
    window.addEventListener('keydown', (e) => {
      if (!E.animMode || e.code !== 'Space' || /input|textarea|select|button/i.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
      e.preventDefault(); $('#pbPlay').click();
    });
  }

  // ---------- drill strip ----------
  let thumbTimer = null;
  function renderStrip() {
    const strip = $('#drillStrip');
    strip.innerHTML = '';
    S.project.drills.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'drillTab' + (d === S.current ? ' on' : '');
      const cv = document.createElement('canvas');
      const H = HD.RINK.heightOf(d.rink), k = 56 / H;
      cv.width = Math.round(HD.RINK.W * k * 2); cv.height = Math.round(56 * 2);
      cv.style.height = '56px'; cv.style.width = Math.round(HD.RINK.W * k) + 'px';
      const c = cv.getContext('2d'); c.scale(k * 2, k * 2);
      HD.R.drawDrill(c, d, { zoom: 1 });
      const n = document.createElement('span'); n.textContent = (i + 1) + '. ' + (d.name || 'Untitled');
      b.append(cv, n);
      b.addEventListener('click', () => { if (d !== S.current) { E.select(null); S.selectDrill(d.id); } });
      strip.appendChild(b);
    });
    const on = $('.drillTab.on', strip); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function syncHistory() {
    $('#btnUndo').disabled = !S.canUndo();
    $('#btnRedo').disabled = !S.canRedo();
  }

  // ---------- files / folder ----------
  const F = HD.fs;
  const clean = (n) => (n || '').replace(/[^\w\- ]+/g, '').trim();
  const today = () => new Date().toISOString().slice(0, 10);
  function exportBase(scope) {
    return (scope === 'current' || S.project.drills.length === 1 ? clean(S.current.name) : 'Hockey drills') || 'Hockey drills';
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function syncFolderBtn() {
    [['drills', '#btnFolder', 'Drills folder', 'drills auto-save here'], ['exports', '#btnExpFolder', 'Exports folder', 'PDFs are saved here']].forEach(([kind, sel, none, what]) => {
      const b = $(sel), st = F.states[kind];
      b.hidden = !F.supported;
      b.className = 'folder';
      let label = none, tip = 'Choose the folder where ' + what;
      if (st === 'needs-permission') { b.classList.add('warn'); label = 'Reconnect ' + F.name(kind); tip = 'Click to allow saving to “' + F.name(kind) + '” again'; }
      else if (st === 'ready') {
        const busy = kind === 'drills' ? F.status : 'idle';
        b.classList.add(busy === 'error' ? 'error' : busy === 'saving' ? 'saving' : 'ready');
        label = busy === 'saving' ? 'Saving…' : busy === 'error' ? 'Save failed' : none.split(' ')[0] + ': ' + F.name(kind);
        tip = 'Saving to “' + F.name(kind) + '” (' + what + '). Click to disconnect.';
      }
      $('span', b).textContent = label; b.title = tip;
    });
  }

  // After connecting: pull in drills already in the Drills folder.
  async function loadFromFolder() {
    const have = new Set(S.project.drills.map((d) => d.id));
    const found = (await F.listDrills()).filter((x) => !have.has(x.drill.id));
    if (!found.length) return;
    const pristine = S.project.drills.length === 1 && !S.current.objects.length;
    if (pristine) {
      S.setProject({ version: 1, currentId: null, drills: found.map((x) => Object.assign(x.drill, { file: x.file })) });
      toast('Loaded ' + found.length + ' drill' + (found.length > 1 ? 's' : '') + ' from your Drills folder');
    } else if (confirm('Found ' + found.length + ' other drill(s) in the Drills folder. Add them to this project?')) {
      S.addLoaded(found);
    }
  }

  async function connectFolder() {
    if (F.state !== 'needs-permission') toast('Pick the folder for your drills (it will remember it)');
    if (!(await F.connect('drills'))) return false;
    try { await loadFromFolder(); } catch (e) { console.error(e); }
    await F.syncNow();
    return true;
  }

  async function connectExports() {
    if (F.states.exports !== 'needs-permission') toast('Pick the folder for your PDF exports (it will remember it)');
    return F.connect('exports');
  }

  function downloadBackup() {
    download(new Blob([S.toFileJSON()], { type: 'application/json' }), exportBase('all') + '.drills.json');
  }

  async function saveFile() {
    if (!F.supported) { downloadBackup(); return; }
    if (F.state !== 'ready' && !(await connectFolder())) return;
    await F.syncNow();
    toast(F.status === 'saved' ? 'Saved to “' + F.name('drills') + '”' : 'Could not save - check folder permission');
  }

  function importText(text) {
    const j = JSON.parse(text);
    const list = j.drill ? [j.drill] : Array.isArray(j.drills) ? j.drills : null;
    if (!list || !list.length) throw new Error('Not a drill file');
    const have = new Set(S.project.drills.map((d) => d.id));
    return list.map((d) => {
      if (!d.id || have.has(d.id)) { d.id = HD.newId(); d.name = (d.name || 'Untitled drill') + ' (imported)'; }
      delete d.file;
      return { file: undefined, drill: d };
    });
  }

  async function openDialog() {
    const dlg = $('#openDlg'), list = $('#openList');
    list.innerHTML = '<div class="empty">Loading…</div>';
    dlg.showModal();
    try {
      const have = new Set(S.project.drills.map((d) => d.id));
      const items = await F.listDrills();
      list.innerHTML = '';
      if (!items.length) list.innerHTML = '<div class="empty">No saved drills in the Drills folder yet.</div>';
      items.forEach((it) => {
        const l = document.createElement('label'), c = document.createElement('input');
        c.type = 'checkbox'; c.checked = !have.has(it.drill.id); c.disabled = have.has(it.drill.id); c._it = it;
        const n = document.createElement('span'); n.textContent = it.drill.name || it.file;
        const m = document.createElement('small'); m.textContent = have.has(it.drill.id) ? 'already open' : it.drill.rink === 'full' ? 'full ice' : 'half ice';
        l.append(c, n, m); list.appendChild(l);
      });
    } catch (e) { list.innerHTML = '<div class="empty">Could not read the folder.</div>'; }
  }

  async function deliverBlob(blob, name) {
    if (F.states.exports === 'ready') {
      try { await F.writeFile('exports', name, blob); toast('Exported to “' + F.name('exports') + '”: ' + name); return; }
      catch (e) { console.error(e); toast('Could not write to the Exports folder - downloading instead'); }
    }
    download(blob, name);
  }
  const deliverPDF = (out) => deliverBlob(out.blob, out.name.replace(/\.pdf$/, '') + ' ' + today() + '.pdf');

  // ---------- help ----------
  function initHelp() {
    const dlg = $('#helpDlg');
    const show = (id) => {
      $$('#helpNav button[data-help]').forEach((b) => b.classList.toggle('on', b.dataset.help === id));
      $$('#helpBody > section').forEach((s) => { s.hidden = s.dataset.help !== id; });
      $('#helpBody').scrollTop = 0;
    };
    $$('#helpNav button[data-help]').forEach((b) => { b.onclick = () => show(b.dataset.help); });
    $$('#helpBody [data-goto]').forEach((a) => { a.onclick = () => show(a.dataset.goto); });
    $('#helpClose').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    const open = () => { dlg.showModal(); };
    $('#btnHelp').onclick = open;
    // samples of each line type, drawn with the real renderer
    $$('#helpBody .legend canvas').forEach((cv) => {
      icon(cv, 96, 44, (c) => { c.scale(0.62, 0.62); HD.R.drawObject(c, mkLine(cv.dataset.kind, [{ x: 8, y: 35 }, { x: 148, y: 35 }])); });
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== '?' || /input|textarea|select/i.test(e.target.tagName)) return;
      e.preventDefault(); if (dlg.open) dlg.close(); else if (!document.querySelector('dialog[open]')) open();
    });
  }

  // ---------- init ----------
  function init() {
    S.init();
    buildPalette();
    E.init($('#board'), $('#stage'), $('#textEdit'));
    HD.ui = { saveFile };
    F.onState = syncFolderBtn;
    syncFolderBtn(); F.restore();

    initAnim();
    initHelp();
    E.onTool = syncTool;
    E.onSelect = syncSelection;
    S.onChange((kind) => {
      syncDrill(); syncHistory(); renderSteps();
      if (kind === 'project' || kind === 'drill') { stopPreview(); E.cancelPick(); E.selectedId = null; E.onSelect(null); E.layout(); renderStrip(); }
      else { E.refresh(); clearTimeout(thumbTimer); thumbTimer = setTimeout(renderStrip, 250); }
    });
    // initial paint
    syncDrill(); syncHistory(); syncTool(); syncColor(); renderStrip(); E.layout();

    // top bar
    $('#btnUndo').onclick = () => S.undo();
    $('#btnRedo').onclick = () => S.redo();
    $('#btnSave').onclick = saveFile;
    $('#btnFolder').onclick = async () => {
      if (F.state === 'ready') { if (confirm('Stop saving drills to “' + F.name('drills') + '”? Your files stay where they are.')) F.disconnect('drills'); }
      else await connectFolder();
    };
    $('#btnExpFolder').onclick = async () => {
      if (F.states.exports === 'ready') { if (confirm('Stop saving PDFs to “' + F.name('exports') + '”? Your files stay where they are.')) F.disconnect('exports'); }
      else await connectExports();
    };
    $('#btnOpen').onclick = () => (F.state === 'ready' ? openDialog() : $('#fileInput').click());
    $('#openImport').onclick = () => $('#fileInput').click();
    $('#openGo').onclick = () => {
      const picked = $$('#openList input:checked').map((c) => c._it);
      $('#openDlg').close();
      if (picked.length) { S.addLoaded(picked); toast('Added ' + picked.length + ' drill' + (picked.length > 1 ? 's' : '')); }
    };
    $('#fileInput').onchange = async (e) => {
      const files = Array.from(e.target.files); e.target.value = '';
      try {
        let all = [];
        for (const f of files) all = all.concat(importText(await f.text()));
        if ($('#openDlg').open) $('#openDlg').close();
        if (all.length) { S.addLoaded(all); toast('Imported ' + all.length + ' drill' + (all.length > 1 ? 's' : '')); }
      } catch (err) { alert('Could not open that file: ' + err.message); }
    };

    // line mode
    $$('#lineMode button').forEach((b) => b.onclick = () => { E.lineMode = b.dataset.mode; syncTool(); });

    // zoom
    const z = (f) => { E.setZoom(E.zoom * f); $('#zoomLabel').textContent = Math.round(E.zoom * 100) + '%'; };
    $('#zoomIn').onclick = () => z(1.2); $('#zoomOut').onclick = () => z(1 / 1.2);
    $('#zoomLabel').onclick = () => { E.setZoom(1); $('#zoomLabel').textContent = '100%'; };
    $('#zoomLabel').title = 'Reset to fit';

    // drill inspector
    $('#drillName').oninput = (e) => { S.current.name = e.target.value; S.save(); clearTimeout(thumbTimer); thumbTimer = setTimeout(renderStrip, 250); };
    $('#drillNotes').oninput = (e) => { S.current.notes = e.target.value; S.save(); };
    $$('#rinkType button').forEach((b) => b.onclick = () => {
      if (S.current.rink === b.dataset.rink) return;
      S.checkpoint(); S.current.rink = b.dataset.rink;
      // keep everything on the ice when shrinking to a half-ice view
      const H = HD.RINK.heightOf(S.current.rink);
      S.current.objects.forEach((o) => (o.type === 'line' ? o.pts : [o]).forEach((q) => { q.y = Math.min(q.y, H - 20); }));
      S.emit('drill');
    });

    // selection actions
    $('#actDel').onclick = () => E.deleteSelected();
    $('#actDup').onclick = () => E.duplicateSelected();
    $('#actFront').onclick = () => E.reorder(true);
    $('#actBack').onclick = () => E.reorder(false);
    $('#actRotL').onclick = () => E.rotateSelected(-15);
    $('#actRotR').onclick = () => E.rotateSelected(15);
    $('#textSize').oninput = (e) => { const o = E.getSelected(); if (o) { o.size = +e.target.value; E.redraw(); } };
    $('#textSize').onpointerdown = () => S.checkpoint();
    $('#textSize').onchange = () => S.emit('objects');
    $('#btnClear').onclick = () => { if (S.current.objects.length && confirm('Remove everything from this drill?')) E.clearAll(); };

    // drill strip buttons
    $('#btnAddHalf').onclick = () => S.addDrill('half');
    $('#btnAddFull').onclick = () => S.addDrill('full');
    $('#btnDupDrill').onclick = () => S.duplicateDrill();
    $('#btnMoveL').onclick = () => S.moveDrill(-1);
    $('#btnMoveR').onclick = () => S.moveDrill(1);
    $('#btnDelDrill').onclick = () => {
      if (S.project.drills.length === 1 ? S.current.objects.length === 0 || confirm('Clear this drill?') : confirm('Remove "' + S.current.name + '" from the project?\n\nIts saved file stays in your Drills folder; nothing is deleted from disk.')) S.deleteDrill();
    };

    // export
    const dlg = $('#exportDlg');
    $('#btnExport').onclick = () => {
      $('#expCount').textContent = S.project.drills.length;
      dlg.showModal();
    };
    $('#exportForm').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'go') {
        const fd = new FormData(e.target);
        const opts = { scope: fd.get('scope'), perPage: +fd.get('perPage'), titles: $('#expTitles').checked, steps: $('#expSteps').checked, filename: exportBase(fd.get('scope')) };
        (async () => {
          // first export: ask where PDFs should go (cancel = normal browser download)
          if (F.supported && F.states.exports !== 'ready') await connectExports();
          try { await deliverPDF(HD.exportPDF(opts)); }
          catch (err) { console.error(err); alert('PDF export failed: ' + err.message); }
        })();
      }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    window.addEventListener('beforeunload', () => S.save());
  }

  window.addEventListener('DOMContentLoaded', init);
})(window.HD = window.HD || {});
