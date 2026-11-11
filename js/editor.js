/* Canvas editor: view transform, selection, drag/move, line drawing, handles, text editing, shortcuts. */
(function (HD) {
  'use strict';
  const S = HD.store, R = HD.R;
  const LINE_TOOLS = ['skate', 'back', 'pass', 'dump', 'shoot'];

  const E = {
    tool: 'select',
    lineMode: 'straight',   // 'straight' | 'curve'
    color: '#111111',
    zoom: 1,
    selectedId: null,
    scale: 1,               // CSS px per world unit
    onSelect: () => {},
    onTool: () => {},
    animMode: false,        // show step badges / attachment links
    pose: null,             // Map of animated positions while previewing (editing is locked)
    picking: null,          // { validate(obj) } while waiting for the user to click a piece
    onPick: () => {},
  };
  let canvas, ctx, stage, textInput;
  let drag = null;          // active pointer interaction
  let hoverCursor = 'default';

  // ---------- view ----------
  E.init = function (canvasEl, stageEl, textEl) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); stage = stageEl; textInput = textEl;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    canvas.addEventListener('drop', onDrop);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
      e.stopPropagation();
    });
    textInput.addEventListener('blur', commitText);
    window.addEventListener('keydown', onKey);
    new ResizeObserver(() => E.layout()).observe(stage);
    E.layout();
  };

  E.drill = () => S.current;

  E.layout = function () {
    const d = S.current;
    const W = HD.RINK.W, H = HD.RINK.heightOf(d.rink);
    const fit = Math.min((stage.clientWidth - 48) / W, (stage.clientHeight - 48 - (E.animMode ? 70 : 0)) / H);
    E.scale = Math.max(0.05, fit * E.zoom);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W * E.scale + 'px';
    canvas.style.height = H * E.scale + 'px';
    canvas.width = Math.round(W * E.scale * dpr);
    canvas.height = Math.round(H * E.scale * dpr);
    E.redraw();
  };

  E.redraw = function () {
    const d = S.current, dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(E.scale * dpr, 0, 0, E.scale * dpr, 0, 0);
    HD.R.drawDrill(ctx, d, {
      selectedId: E.selectedId, zoom: E.scale, hideId: textInput.dataset.editing || null,
      pose: E.pose, dim: !!E.pose, badges: E.animMode && !E.pose,
    });
  };

  E.setZoom = (z) => { E.zoom = Math.max(0.5, Math.min(3, z)); E.layout(); };

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function world(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / E.scale, y: (e.clientY - r.top) / E.scale };
  }
  const worldH = () => HD.RINK.heightOf(S.current.rink);
  const sel = () => S.current.objects.find((o) => o.id === E.selectedId) || null;

  E.select = function (id) {
    E.selectedId = id;
    E.onSelect(sel());
    E.redraw();
  };
  E.getSelected = sel;

  function pick(p) {
    const objs = S.current.objects, tol = 4 / E.scale;
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type !== 'line' && R.hit(objs[i], p.x, p.y, tol)) return objs[i];
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type === 'line' && R.hit(objs[i], p.x, p.y, tol)) return objs[i];
    return null;
  }

  function handleAt(p) {
    const o = sel();
    if (!o || o.type !== 'line' || o.kind === 'free') return -1;
    const rad = 16 / E.scale;
    // test the middle handle first so it can be grabbed when points overlap
    const order = o.pts.length === 3 ? [1, 2, 0] : [1, 0];
    for (const i of order) if (o.pts[i] && Math.hypot(p.x - o.pts[i].x, p.y - o.pts[i].y) <= rad) return i;
    return -1;
  }

  // ---------- placing ----------
  E.place = function (kind, label, p) {
    S.checkpoint();
    const base = { id: HD.newId(), x: clamp(p.x, 0, HD.RINK.W), y: clamp(p.y, 0, worldH()) };
    let o;
    if (kind === 'player') o = { ...base, type: 'player', label, color: E.color };
    else if (kind === 'coach') o = { ...base, type: 'player', label: '\u00a9', color: E.color };
    else if (kind === 'puck') o = { ...base, type: 'puck', color: '#111111' };
    else if (kind === 'cone') o = { ...base, type: 'cone', color: '#ff7a1a', rot: 0 };
    else if (kind === 'net') o = { ...base, type: 'net', color: '#c8102e', rot: 0 };
    else if (kind === 'stick') o = { ...base, type: 'stick', color: '#6b4423', rot: 0 };
    else return;
    S.current.objects.push(o);
    E.selectedId = o.id;
    S.emit('objects');
    E.onSelect(o);
  };

  function onDrop(e) {
    e.preventDefault();
    const kind = e.dataTransfer.getData('text/hd-kind');
    if (!kind) return;
    E.place(kind, e.dataTransfer.getData('text/hd-label'), world(e));
  }

  // ---------- pointer ----------
  function onDown(e) {
    if (e.button !== 0 || E.pose) return;
    commitText();
    canvas.setPointerCapture(e.pointerId);
    const p = world(e);

    if (E.picking) {                       // attaching a piece to a motion
      const t = pickPiece(p);
      if (t && E.picking.validate(t)) { E.picking = null; canvas.style.cursor = 'default'; E.onPick(false); }
      return;
    }

    if (E.tool === 'draw') { drag = { mode: 'pen', obj: null, pts: [p] }; return; }

    const h = handleAt(p);
    if (h >= 0) { drag = { mode: 'handle', idx: h, moved: false }; return; }

    if (E.tool === 'text') { openText({ x: p.x, y: p.y }, null); return; }

    if (LINE_TOOLS.includes(E.tool)) {
      drag = { mode: 'draw', start: p, obj: null };
      return;
    }

    const o = pick(p);
    if (o) {
      E.select(o.id);
      drag = { mode: 'move', last: p, moved: false };
    } else {
      E.select(null);
      drag = null;
    }
  }

  function onMove(e) {
    const p = world(e);
    if (!drag) { updateCursor(p); return; }
    const o = sel();

    if (drag.mode === 'pen') {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 4) return;
      const q = { x: clamp(p.x, 0, HD.RINK.W), y: clamp(p.y, 0, worldH()) };
      drag.pts.push(q);
      if (!drag.obj) {
        S.checkpoint();
        drag.obj = { id: HD.newId(), type: 'line', kind: 'free', color: E.color, pts: drag.pts };
        S.current.objects.push(drag.obj);
      }
      E.redraw();
      return;
    }

    if (drag.mode === 'draw') {
      const dist = Math.hypot(p.x - drag.start.x, p.y - drag.start.y);
      if (!drag.obj) {
        if (dist < 6 / E.scale) return;
        S.checkpoint();
        drag.obj = { id: HD.newId(), type: 'line', kind: E.tool, color: E.color, pts: E.lineMode === 'curve' ? [{ ...drag.start }, { ...drag.start }, { ...drag.start }] : [{ ...drag.start }, { ...drag.start }] };
        S.current.objects.push(drag.obj);
        E.selectedId = drag.obj.id;
      }
      shapeLine(drag.obj, drag.start, p);
      E.redraw();
      return;
    }

    if (!o) return;
    if (drag.mode === 'handle') {
      if (!drag.moved) { S.checkpoint(); drag.moved = true; }
      o.pts[drag.idx] = { x: clamp(p.x, 0, HD.RINK.W), y: clamp(p.y, 0, worldH()) };
      E.redraw();
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) * E.scale < 3) return;
        S.checkpoint(); drag.moved = true;
      }
      moveObj(o, dx, dy);
      drag.last = p;
      E.redraw();
    }
  }

  function shapeLine(o, a, b) {
    o.pts[0] = { x: a.x, y: a.y };
    o.pts[o.pts.length - 1] = { x: clamp(b.x, 0, HD.RINK.W), y: clamp(b.y, 0, worldH()) };
    if (o.pts.length === 3) {
      // start with a gentle bow so the curve handle is obviously separate from the ends
      const e = o.pts[2], mx = (a.x + e.x) / 2, my = (a.y + e.y) / 2;
      const dx = e.x - a.x, dy = e.y - a.y, len = Math.hypot(dx, dy) || 1;
      o.pts[1] = { x: mx - (dy / len) * len * 0.18, y: my + (dx / len) * len * 0.18 };
    }
  }

  function moveObj(o, dx, dy) {
    if (o.type === 'line') {
      // keep the whole line inside the rink
      const b = R.bounds(o);
      dx = clamp(dx, -b.x, HD.RINK.W - (b.x + b.w)); dy = clamp(dy, -b.y, worldH() - (b.y + b.h));
      o.pts.forEach((q) => { q.x += dx; q.y += dy; });
    } else {
      o.x = clamp(o.x + dx, 0, HD.RINK.W); o.y = clamp(o.y + dy, 0, worldH());
    }
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'pen') {
      if (d.obj) {
        if (d.pts.length < 3) { S.current.objects.pop(); S.hist().undo.pop(); }
        S.emit('objects');
      }
      E.redraw();
      return;
    }
    if (d.mode === 'draw') {
      if (d.obj) {
        const L = Math.hypot(d.obj.pts[d.obj.pts.length - 1].x - d.obj.pts[0].x, d.obj.pts[d.obj.pts.length - 1].y - d.obj.pts[0].y);
        if (L < 20) { S.current.objects.pop(); S.hist().undo.pop(); E.selectedId = null; }
        S.emit('objects'); E.onSelect(sel());
      }
    } else if (d.moved) {
      S.emit('objects');
    }
    E.redraw();
  }

  function onDbl(e) {
    if (E.pose) return;
    const o = pick(world(e));
    if (o && o.type === 'text') openText({ x: o.x, y: o.y }, o);
  }

  function updateCursor(p) {
    let c = 'default';
    if (E.tool === 'text') c = 'text';
    else if (LINE_TOOLS.includes(E.tool) || E.tool === 'draw' || E.picking) c = 'crosshair';
    if (E.pose) c = 'default';
    else if (handleAt(p) >= 0) c = 'grab';
    else if (E.tool === 'select' && pick(p)) c = 'move';
    if (c !== hoverCursor) { canvas.style.cursor = c; hoverCursor = c; }
  }

  // A piece (not a line) under the pointer, for attaching to motions.
  function pickPiece(p) {
    const objs = S.current.objects, tol = 6 / E.scale;
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type !== 'line' && R.hit(objs[i], p.x, p.y, tol)) return objs[i];
    return null;
  }

  E.startPick = function (validate) {
    E.picking = { validate };
    canvas.style.cursor = 'crosshair';
    E.onPick(true);
  };
  E.cancelPick = function () {
    if (!E.picking) return;
    E.picking = null; canvas.style.cursor = 'default'; E.onPick(false);
  };

  // ---------- text ----------
  let textTarget = null, textPos = null;
  function openText(pos, existing) {
    textTarget = existing; textPos = pos;
    const size = existing ? existing.size : 36;
    textInput.dataset.editing = existing ? existing.id : '';
    textInput.style.display = 'block';
    textInput.style.fontSize = size * E.scale + 'px';
    textInput.value = existing ? existing.text : '';
    textInput.style.color = existing ? existing.color : E.color;
    const r = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const w = 220;
    textInput.style.width = w + 'px';
    textInput.style.left = (r.left - sr.left + stage.scrollLeft + pos.x * E.scale - w / 2) + 'px';
    textInput.style.top = (r.top - sr.top + stage.scrollTop + pos.y * E.scale - (size * E.scale * 1.3) / 2) + 'px';
    textInput.style.height = size * E.scale * 1.3 + 'px';
    E.redraw();
    setTimeout(() => { textInput.focus(); textInput.select(); }, 0);
  }

  function closeText() { textInput.style.display = 'none'; textInput.dataset.editing = ''; textTarget = null; textPos = null; }
  function cancelText() { textInput.value = textTarget ? textTarget.text : ''; closeText(); E.redraw(); }

  function commitText() {
    if (textInput.style.display !== 'block') return;
    const val = textInput.value.trim(), t = textTarget, pos = textPos;
    closeText();
    if (t) {
      if (!val) { S.checkpoint(); S.current.objects = S.current.objects.filter((o) => o !== t); E.selectedId = null; }
      else if (val !== t.text) { S.checkpoint(); t.text = val; }
      else { E.redraw(); return; }
    } else if (val) {
      S.checkpoint();
      const o = { id: HD.newId(), type: 'text', x: pos.x, y: pos.y, text: val, size: 36, color: E.color };
      S.current.objects.push(o); E.selectedId = o.id;
    } else { E.redraw(); return; }
    S.emit('objects'); E.onSelect(sel());
  }

  // ---------- edit commands ----------
  E.setTool = function (t) {
    E.tool = t; commitText(); E.cancelPick();
    canvas.style.cursor = t === 'text' ? 'text' : LINE_TOOLS.includes(t) || t === 'draw' ? 'crosshair' : 'default';
    E.onTool(t);
  };

  E.setColor = function (c) {
    E.color = c;
    const o = sel();
    if (o && o.type !== 'puck') { S.checkpoint(); o.color = c; S.emit('objects'); E.onSelect(o); }
  };

  E.deleteSelected = function () {
    const o = sel(); if (!o) return;
    S.checkpoint();
    S.current.objects = S.current.objects.filter((x) => x !== o);
    E.selectedId = null; S.emit('objects'); E.onSelect(null);
  };

  E.duplicateSelected = function () {
    const o = sel(); if (!o) return;
    S.checkpoint();
    const c = JSON.parse(JSON.stringify(o)); c.id = HD.newId();
    if (c.type === 'line') c.pts.forEach((q) => { q.x += 30; q.y += 30; }); else { c.x += 30; c.y += 30; }
    S.current.objects.push(c); E.selectedId = c.id; S.emit('objects'); E.onSelect(c);
  };

  E.rotateSelected = function (deg) {
    const o = sel(); if (!o || (o.type !== 'cone' && o.type !== 'stick' && o.type !== 'net')) return;
    S.checkpoint(); o.rot = (o.rot || 0) + deg * Math.PI / 180; S.emit('objects'); E.onSelect(o);
  };

  E.reorder = function (toFront) {
    const o = sel(); if (!o) return;
    S.checkpoint();
    const a = S.current.objects; a.splice(a.indexOf(o), 1); toFront ? a.push(o) : a.unshift(o);
    S.emit('objects');
  };

  E.setSelectedProp = function (prop, val) {
    const o = sel(); if (!o) return;
    S.checkpoint(); o[prop] = val; S.emit('objects'); E.onSelect(o);
  };

  E.clearAll = function () {
    if (!S.current.objects.length) return;
    S.checkpoint(); S.current.objects = []; E.selectedId = null; S.emit('objects'); E.onSelect(null);
  };

  E.refresh = function () {  // after drill switch / undo
    if (!sel()) E.selectedId = null;
    E.onSelect(sel());
    E.layout();
  };

  // ---------- keyboard ----------
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (document.querySelector('dialog[open]') || E.pose) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); S.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); E.duplicateSelected(); return; }
    if (mod && k === 's') { e.preventDefault(); HD.ui && HD.ui.saveFile(); return; }
    if (mod) return;

    if (k === 'delete' || k === 'backspace') { e.preventDefault(); E.deleteSelected(); return; }
    if (k === 'escape') { if (E.picking) { E.cancelPick(); return; } E.setTool('select'); E.select(null); return; }
    if (k === 'r') { E.rotateSelected(e.shiftKey ? -15 : 15); return; }

    const o = sel();
    if (o && k.startsWith('arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 25 : 5;
      S.checkpoint();
      moveObj(o, k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      S.emit('objects'); return;
    }
    const map = { v: 'select', f: 'skate', b: 'back', p: 'pass', u: 'dump', s: 'shoot', t: 'text', d: 'draw' };
    if (map[k]) E.setTool(map[k]);
    if (k === 'c') { E.lineMode = E.lineMode === 'curve' ? 'straight' : 'curve'; E.onTool(E.tool); }
  }

  HD.editor = E;
})(window.HD = window.HD || {});
