/* Drawing + geometry for every drill object. Shared by the on-screen editor and the PDF exporter,
 * so what you see is exactly what gets exported. All sizes are in world units (see rink.js). */
(function (HD) {
  'use strict';

  const FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
  const PLAYER_R = 30, PUCK_R = 9;
  const measureCtx = document.createElement('canvas').getContext('2d');

  // ---------- path geometry ----------
  // Lines hold 2 points (straight) or 3 points (curve through the middle point).
  function flatten(obj) {
    const p = obj.pts;
    if (obj.kind === 'free') return p;
    if (p.length < 3) return [{ x: p[0].x, y: p[0].y }, { x: p[1].x, y: p[1].y }];
    const cx = 2 * p[1].x - (p[0].x + p[2].x) / 2;
    const cy = 2 * p[1].y - (p[0].y + p[2].y) / 2;
    const out = [];
    const N = 56;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      out.push({
        x: u * u * p[0].x + 2 * u * t * cx + t * t * p[2].x,
        y: u * u * p[0].y + 2 * u * t * cy + t * t * p[2].y,
      });
    }
    return out;
  }

  function polyLength(poly) {
    let L = 0;
    for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    return L;
  }

  // Sample point + unit tangent at arc-length s along poly.
  function sampleAt(poly, s) {
    let acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg === 0) continue;
      if (acc + seg >= s || i === poly.length - 1) {
        const t = Math.min(1, Math.max(0, (s - acc) / seg));
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
      }
      acc += seg;
    }
    const a = poly[0];
    return { x: a.x, y: a.y, tx: 1, ty: 0 };
  }

  // Polyline truncated to arc-length s.
  function truncate(poly, s) {
    const out = [poly[0]];
    let acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= s) {
        const t = seg ? (s - acc) / seg : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        return out;
      }
      out.push(b); acc += seg;
    }
    return out;
  }

  function offsetPoly(poly, d) {
    return poly.map((p, i) => {
      const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
      return { x: p.x - ty * d, y: p.y + tx * d };
    });
  }

  function strokePoly(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.stroke();
  }

  function arrowHead(ctx, x, y, tx, ty, len, wid) {
    const nx = -ty, ny = tx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - tx * len + nx * wid / 2, y - ty * len + ny * wid / 2);
    ctx.lineTo(x - tx * len - nx * wid / 2, y - ty * len - ny * wid / 2);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- lines ----------
  function drawFree(ctx, o) {
    const p = o.pts;
    if (p.length < 2) return;
    ctx.save();
    ctx.strokeStyle = o.color; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) {      // smooth through segment midpoints
      ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawLine(ctx, o) {
    if (o.kind === 'free') return drawFree(ctx, o);
    const full = flatten(o);
    const L = polyLength(full);
    if (L < 1) return;
    ctx.save();
    ctx.strokeStyle = o.color; ctx.fillStyle = o.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const end = sampleAt(full, L);
    const back = sampleAt(full, Math.max(0, L - 20)); // tangent averaged over the last stretch
    let tx = end.x - back.x, ty = end.y - back.y;
    const tm = Math.hypot(tx, ty) || 1; tx /= tm; ty /= tm;

    if (o.kind === 'skate') {
      const head = 40;
      ctx.lineWidth = 8;
      strokePoly(ctx, truncate(full, Math.max(1, L - head * 0.7)));
      arrowHead(ctx, end.x, end.y, tx, ty, head, 36);
    } else if (o.kind === 'pass') {
      const head = 30;
      ctx.lineWidth = 4.5; ctx.setLineDash([2, 14]);   // round-capped dashes read as dots
      strokePoly(ctx, truncate(full, Math.max(1, L - head * 0.7)));
      ctx.setLineDash([]);
      arrowHead(ctx, end.x, end.y, tx, ty, head, 28);
    } else if (o.kind === 'dump') {
      const head = 34;
      ctx.lineWidth = 4.5; ctx.setLineDash([2, 14]);
      strokePoly(ctx, truncate(full, Math.max(1, L - head * 0.8)));
      ctx.setLineDash([]);
      const nx = -ty, ny = tx;                                   // hollow arrowhead
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - tx * head + nx * 14, end.y - ty * head + ny * 14);
      ctx.lineTo(end.x - tx * head - nx * 14, end.y - ty * head - ny * 14);
      ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 3.5; ctx.stroke();
      if (L > 120) {                                             // double bar across the middle: the "dump" mark
        const m = sampleAt(full, L / 2);
        ctx.lineWidth = 4; ctx.lineCap = 'butt';
        for (const off of [-5, 5]) {
          const cx = m.x + m.tx * off, cy = m.y + m.ty * off;
          ctx.beginPath(); ctx.moveTo(cx - m.ty * 14, cy + m.tx * 14); ctx.lineTo(cx + m.ty * 14, cy - m.tx * 14); ctx.stroke();
        }
      }
    } else if (o.kind === 'shoot') {
      const head = 44;
      const shaft = truncate(full, Math.max(1, L - head * 0.7));
      ctx.lineWidth = 4.5; ctx.lineCap = 'butt';
      strokePoly(ctx, offsetPoly(shaft, 7));
      strokePoly(ctx, offsetPoly(shaft, -7));
      arrowHead(ctx, end.x, end.y, tx, ty, head, 44);
    } else if (o.kind === 'back') {
      const head = 40, step = 30, half = 13, bulge = 8, stagger = 4;
      ctx.lineWidth = 4.5;
      const limit = L - head * 0.8;
      let i = 0;
      for (let s = step / 2; s <= limit; s += step, i++) {
        const q = sampleAt(full, s);
        const dir = i % 2 === 0 ? -1 : 1;               // '(' then ')' ...
        const off = (i % 2 === 0 ? 1 : -1) * stagger;   // ...slightly staggered up/down
        ctx.save();
        ctx.translate(q.x - q.ty * off, q.y + q.tx * off);
        ctx.rotate(Math.atan2(q.ty, q.tx));
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.quadraticCurveTo(0, dir * bulge * 2, half, 0);
        ctx.stroke();
        ctx.restore();
      }
      arrowHead(ctx, end.x, end.y, tx, ty, head, 36);
    }
    ctx.restore();
  }

  // ---------- point objects ----------
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  function drawPlayer(ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.label === '\u00a9') {                       // coach: a copyright-style (C)
      ctx.beginPath(); ctx.arc(0, 0, PLAYER_R - 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = o.color; ctx.stroke();
      ctx.fillStyle = o.color; ctx.font = `700 34px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('C', 0, 2);
      ctx.restore();
      return;
    }
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = o.color; ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = luminance(o.color) > 0.75 ? '#111' : 'rgba(0,0,0,.55)'; ctx.stroke();
    ctx.fillStyle = luminance(o.color) > 0.55 ? '#111' : '#fff';
    const n = o.label.length;
    ctx.font = `700 ${n > 1 ? 24 : 30}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.label, 0, 2);
    ctx.restore();
  }

  function drawPuck(ctx, o) {
    ctx.beginPath(); ctx.arc(o.x, o.y, PUCK_R, 0, Math.PI * 2);
    ctx.fillStyle = o.color; ctx.fill();
  }

  function drawCone(ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(22, 18); ctx.lineTo(-22, 18); ctx.closePath();
    ctx.fillStyle = o.color; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }

  function drawStick(ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-16, -52); ctx.lineTo(4, 22); ctx.stroke();            // shaft
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(4, 22); ctx.quadraticCurveTo(8, 34, 36, 34); ctx.stroke(); // blade
    ctx.restore();
  }

  // Hockey net, opening facing down at rotation 0 (6ft wide x 4ft deep, drawn slightly larger to read well).
  function drawNet(ctx, o) {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-34, 24); ctx.lineTo(-34, -10); ctx.quadraticCurveTo(-34, -24, -20, -24);
      ctx.lineTo(20, -24); ctx.quadraticCurveTo(34, -24, 34, -10); ctx.lineTo(34, 24);
    };
    ctx.save();
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
    path(); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
    ctx.save(); path(); ctx.clip();                      // mesh, clipped to the net
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = -80; i < 80; i += 9) { ctx.moveTo(i, -30); ctx.lineTo(i + 56, 30); ctx.moveTo(i, 30); ctx.lineTo(i + 56, -30); }
    ctx.stroke(); ctx.restore();
    path(); ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.color; ctx.stroke();
    ctx.restore();
  }

  function textMetrics(o) {
    measureCtx.font = `700 ${o.size}px ${FONT}`;
    return { w: measureCtx.measureText(o.text || ' ').width, h: o.size * 1.15 };
  }

  function drawText(ctx, o) {
    ctx.save();
    ctx.font = `700 ${o.size}px ${FONT}`;
    ctx.fillStyle = o.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.text, o.x, o.y);
    ctx.restore();
  }

  // ---------- bounds / hit testing ----------
  function bounds(o) {
    switch (o.type) {
      case 'player': return { x: o.x - PLAYER_R, y: o.y - PLAYER_R, w: PLAYER_R * 2, h: PLAYER_R * 2 };
      case 'puck': return { x: o.x - 16, y: o.y - 16, w: 32, h: 32 };
      case 'flag': return { x: o.x - 8, y: o.y - 62, w: 52, h: 70 };
      case 'text': { const m = textMetrics(o); return { x: o.x - m.w / 2, y: o.y - m.h / 2, w: m.w, h: m.h }; }
      case 'line': {
        const pts = flatten(o);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      default: return null; // cone / stick use a rotated local box
    }
  }

  const LOCAL_BOX = { cone: [-26, -28, 26, 22], stick: [-26, -58, 44, 42], net: [-40, -30, 40, 30] }; // [x0,y0,x1,y1]

  function toLocal(o, x, y) {
    const dx = x - o.x, dy = y - o.y, c = Math.cos(-(o.rot || 0)), s = Math.sin(-(o.rot || 0));
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function distToPoly(poly, x, y) {
    let best = 1e9;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      let t = l2 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return best;
  }

  function hit(o, x, y, tol) {
    switch (o.type) {
      case 'player': return Math.hypot(x - o.x, y - o.y) <= PLAYER_R + tol;
      case 'puck': return Math.hypot(x - o.x, y - o.y) <= PUCK_R + 8 + tol;
      case 'flag': return x >= o.x - 16 - tol && x <= o.x + 40 + tol && y >= o.y - 60 - tol && y <= o.y + 12 + tol;
      case 'text': { const b = bounds(o); return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol; }
      case 'cone': case 'stick': case 'net': {
        const l = toLocal(o, x, y), b = LOCAL_BOX[o.type];
        return l.x >= b[0] - tol && l.x <= b[2] + tol && l.y >= b[1] - tol && l.y <= b[3] + tol;
      }
      case 'line': return distToPoly(flatten(o), x, y) <= (o.kind === 'free' ? 10 : 18) + tol;
    }
    return false;
  }

  // ---------- selection chrome ----------
  function drawSelection(ctx, o, zoom) {
    const px = 1 / zoom; // 1 screen pixel in world units
    ctx.save();
    ctx.strokeStyle = '#2f7bff'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]);
    if (o.type === 'cone' || o.type === 'stick' || o.type === 'net') {
      const b = LOCAL_BOX[o.type];
      ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0);
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    } else if (o.type === 'line' && o.kind === 'free') {
      const b = bounds(o), pad = 8;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    } else if (o.type === 'line') {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5 * px;
      const pts = o.pts;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.setLineDash([4 * px, 4 * px]); ctx.stroke();
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      pts.forEach((p, i) => {
        const r = 8 * px * (zoom < 0.5 ? 1.2 : 1) * 1.0;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = i === 1 && pts.length === 3 ? '#ffffff' : '#2f7bff';
        ctx.fill(); ctx.lineWidth = 2.5 * px; ctx.strokeStyle = '#2f7bff'; ctx.stroke();
      });
    } else {
      const b = bounds(o), pad = 5;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    }
    ctx.restore();
  }

  function drawObject(ctx, o) {
    switch (o.type) {
      case 'player': return drawPlayer(ctx, o);
      case 'puck': return drawPuck(ctx, o);
      case 'cone': return drawCone(ctx, o);
      case 'stick': return drawStick(ctx, o);
      case 'net': return drawNet(ctx, o);
      case 'text': return drawText(ctx, o);
      case 'line': return drawLine(ctx, o);
    }
  }

  const ACCENT = '#2f7bff';

  // Checkpoint flag: a pole planted at (x, y) with a numbered pennant. Shown while animating only (never in PDF / video).
  function drawFlag(ctx, o, n) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -58); ctx.lineWidth = 4; ctx.strokeStyle = '#333'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(38, -47); ctx.lineTo(0, -36); ctx.closePath();
    ctx.fillStyle = '#e8590c'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 10, -47);
    ctx.restore();
  }

  // Animation overlays: numbered step badges on motions, plus links from the selected motion to its pieces.
  function drawAnimOverlay(ctx, drill, selectedId, zoom) {
    const px = 1 / zoom, byId = new Map(drill.objects.map((o) => [o.id, o]));
    const used = new Map();                                   // "step|piece" -> how many motions use that piece in that step
    for (const o of drill.objects) if (o.type === 'line' && o.kind !== 'free' && o.anim && o.anim.actors && o.anim.actors.length) {
      for (const id of o.anim.actors) { const k = (o.anim.step || 1) + '|' + id; used.set(k, (used.get(k) || 0) + 1); }
    }
    ctx.save();
    let fn = 0;
    for (const o of drill.objects) if (o.type === 'flag') drawFlag(ctx, o, ++fn);
    for (const o of drill.objects) {
      if (o.type !== 'line' || o.kind === 'free' || !o.anim || !o.anim.actors || !o.anim.actors.length) continue;
      const p = o.pts[0];
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      const step = o.anim.step || 1;       // 1a / 1b only when one player or puck has several motions in that step
      const label = step + (o.anim.actors.some((id) => used.get(step + '|' + id) > 1) ? String.fromCharCode(96 + Math.min(26, o.anim.sub || 1)) : '');
      ctx.fillStyle = '#fff'; ctx.font = `700 ${label.length > 2 ? 12 : label.length > 1 ? 14 : 17}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x, p.y + 1);
    }
    const sel = byId.get(selectedId);
    if (sel && sel.type === 'line' && sel.anim && sel.anim.trigger) {            // what the selected motion waits for
      const t = sel.anim.trigger, start = sel.pts[0];
      const from = t.kind === 'flag' ? byId.get(t.flag) : byId.get(t.motion);
      const fp = from && (from.type === 'line' ? (t.when === 'end' ? from.pts[from.pts.length - 1] : from.pts[0]) : { x: from.x, y: from.y - 30 });
      ctx.save(); ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 3; ctx.setLineDash([3, 7]); ctx.lineCap = 'round';
      if (fp) { ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(start.x, start.y); ctx.stroke(); }
      const w = t.kind === 'flag' ? byId.get(t.who) : null;
      if (w) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(w.x, w.y, w.type === 'puck' ? 18 : PLAYER_R + 7, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    if (sel && sel.type === 'line' && sel.anim) {
      const start = sel.pts[0];
      const ids = (sel.anim.actors || []).concat(sel.anim.carry ? [sel.anim.carry] : []);
      for (const id of ids) {
        const t = byId.get(id); if (!t) continue;
        ctx.setLineDash([8, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = ACCENT;
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(start.x, start.y); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 3.5 * Math.max(1, px * 1.5);
        ctx.beginPath(); ctx.arc(t.x, t.y, (t.type === 'puck' ? 18 : PLAYER_R + 7), 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Draws rink + objects in world units (caller sets the scale transform).
  // opts: selectedId, zoom, hideId, pose (Map id -> {x,y} animation overrides), dim, badges
  function drawDrill(ctx, drill, opts) {
    opts = opts || {};
    const pose = opts.pose;
    const at = (o) => (pose && pose.has(o.id) ? Object.assign({}, o, pose.get(o.id)) : o);
    HD.RINK.draw(ctx, drill.rink);
    // lines underneath, pieces on top (pucks last), so labels are never hidden by arrows
    ctx.save();
    if (opts.dim) ctx.globalAlpha = 0.3;
    for (const o of drill.objects) if (o.type === 'line') drawObject(ctx, o);
    ctx.restore();
    const pieces = drill.objects.filter((o) => o.type !== 'line' && o.type !== 'flag' && o.id !== opts.hideId);
    for (const o of pieces) if (o.type === 'net') drawObject(ctx, at(o));
    for (const o of pieces) if (o.type !== 'puck' && o.type !== 'net') drawObject(ctx, at(o));
    for (const o of pieces) if (o.type === 'puck') drawObject(ctx, at(o));
    if (opts.badges) drawAnimOverlay(ctx, drill, opts.selectedId, opts.zoom || 1);
    if (opts.selectedId && !pose) {
      const s = drill.objects.find((o) => o.id === opts.selectedId);
      if (s) drawSelection(ctx, s, opts.zoom || 1);
    }
  }

  HD.R = { drawDrill, drawObject, hit, bounds, textMetrics, flatten, polyLength, sampleAt, PLAYER_R, FONT };
})(window.HD = window.HD || {});
