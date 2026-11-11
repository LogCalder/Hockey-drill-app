/* Drill animation.
 *
 * Data (stored on each motion line):  line.anim = { step: 1, actors: [objectId...], carry: puckId | null, speed: 1 }
 *   - skate / back lines: actors are players (or the coach); they follow the path. `carry` is a puck that moves with them.
 *   - pass / shoot lines: actors are pucks; they travel along the line.
 *   - speed: optional per-motion multiplier (0.5 - 2, default 1).
 * Motions with the same step play together; steps play one after another.
 * A pass/shot only fires once the puck's carrier (a skating line in the same step carrying that puck)
 * reaches the start of the pass/shot line, so it never happens "randomly". If the same puck has several passes/shots
 * in one step, each one waits for the previous to arrive. Playback never edits the drill: poseAt() just computes
 * where every piece is at time t.
 */
(function (HD) {
  'use strict';
  const R = HD.R;
  const SPEED = { skate: 320, back: 230, pass: 480, shoot: 900 };    // world units (0.1 ft) per second
  const GAP = 0.25;            // pause between steps (s)
  const TRIGGER_R = 55;        // carrier counts as "at the start" within this distance
  const BLEND = 0.3;           // s: a fired pass eases from the carried puck position onto its line
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isShot = (l) => l.kind === 'pass' || l.kind === 'shoot';
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const COLOR_NAMES = { '#111111': 'black', '#e03131': 'red', '#1c6fe0': 'blue', '#2f9e44': 'green', '#f08c00': 'orange', '#7048e8': 'purple', '#ffffff': 'white' };
  const A = { tl: null, t: 0, playing: false, rate: 1, raf: 0, last: 0, onFrame: () => {} };

  A.name = (o) => (o.type === 'puck' ? 'puck' : (o.label === '©' ? 'Coach' : o.label) + ' (' + (COLOR_NAMES[o.color] || 'custom') + ')');

  // Motions that actually have something attached.
  function usable(drill) {
    const ids = new Set(drill.objects.map((o) => o.id));
    return drill.objects.filter((o) => o.type === 'line' && o.kind !== 'free' && o.anim &&
      (o.anim.actors || []).some((id) => ids.has(id)));
  }
  A.hasMotions = (drill) => usable(drill).length > 0;
  A.unattached = (drill) => drill.objects.filter((o) => o.type === 'line' && o.kind !== 'free').length - usable(drill).length;

  A.build = function (drill) {
    const ids = new Set(drill.objects.map((o) => o.id));
    const groups = new Map();
    for (const l of usable(drill)) {
      const k = l.anim.step || 1;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    const steps = [];
    let clock = 0;
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      const items = groups.get(k).map((l) => {
        const poly = R.flatten(l), len = R.polyLength(poly), speed = SPEED[l.kind] * clamp(l.anim.speed || 1, 0.25, 4);
        return {
          line: l, poly, len, speed, shot: isShot(l), t0: 0, carrier: null,
          dur: Math.max(0.3, len / speed),
          actors: l.anim.actors.filter((id) => ids.has(id)),
          carry: l.anim.carry && ids.has(l.anim.carry) ? l.anim.carry : null,
        };
      });
      const movers = items.filter((i) => !i.shot), shots = items.filter((i) => i.shot);

      // A pass/shot that continues from an earlier pass/shot of the same puck (it starts where that one ends)
      // follows that one: the puck is with the receiver now, not with whoever carried it before.
      for (const sh of shots) {
        let best = null, bd = TRIGGER_R * 1.6;
        for (const prev of shots) {
          if (prev === sh || prev.actors[0] !== sh.actors[0]) continue;
          const d = dist(prev.poly[prev.poly.length - 1], sh.poly[0]);
          if (d <= bd && !(prev.after === sh)) { best = prev; bd = d; }
        }
        sh.after = best;
      }

      // Otherwise it waits until its puck's carrier reaches the start of the pass/shot line.
      for (const sh of shots) {
        if (sh.after) continue;
        const carrier = movers.find((m) => m.carry && m.carry === sh.actors[0]);
        if (!carrier) continue;
        sh.carrier = carrier;
        const origin = sh.poly[0];
        let acc = 0, hitAt = null;
        for (let i = 0; i < carrier.poly.length; i++) {
          if (i) acc += dist(carrier.poly[i], carrier.poly[i - 1]);
          if (dist(carrier.poly[i], origin) <= TRIGGER_R) { hitAt = acc; break; }
        }
        sh.t0 = hitAt === null ? carrier.dur : hitAt / carrier.speed;   // never near it: fire when the carrier finishes
      }
      // Chained ones start when the previous pass/shot arrives (resolved in dependency order).
      for (let round = 0; round < shots.length; round++) {
        for (const sh of shots) if (sh.after) sh.t0 = sh.after.t0 + sh.after.dur;
      }

      shots.sort((a, b) => a.t0 - b.t0);          // later ones override earlier ones
      const ordered = movers.concat(shots);      // shots last so they override a carried puck
      const dur = Math.max(...ordered.map((i) => i.t0 + i.dur));
      steps.push({ step: k, start: clock, dur, items: ordered });
      clock += dur + GAP;
    }
    return { steps, total: Math.max(0.01, clock - GAP) };
  };

  // Position of every moving piece at time t. Returns Map id -> {x, y}.
  A.poseAt = function (drill, tl, t) {
    const pos = new Map();
    for (const o of drill.objects) if (o.type !== 'line') pos.set(o.id, { x: o.x, y: o.y });
    for (const step of tl.steps) {
      const local = t - step.start;
      if (local < 0) break;
      // formation + carry offsets are taken from where everything is when the step begins
      const info = step.items.map((it) => {
        const lead = pos.get(it.actors[0]);
        const offs = it.actors.map((id) => { const p = pos.get(id); return { dx: p.x - lead.x, dy: p.y - lead.y }; });
        let carryRel = null;
        if (it.carry) {
          const c = pos.get(it.carry), dx = c.x - lead.x, dy = c.y - lead.y;
          carryRel = Math.hypot(dx, dy) < 90 ? { dx, dy } : { dx: 24, dy: 8 };
        }
        return { offs, carryRel, rest: { x: lead.x, y: lead.y } };
      });
      step.items.forEach((it, n) => {
        if (it.shot && local < it.t0) return;                       // not fired yet
        const u = clamp(local - it.t0, 0, it.dur);
        const q = R.sampleAt(it.poly, Math.min(it.len, (u / it.dur) * it.len));
        // Ease from where the piece actually is onto its line (no teleporting): a mover from where it rested,
        // a pass/shot from the carried puck, or from where the previous pass/shot just arrived.
        let src = info[n].rest;
        if (it.shot && it.after) src = it.after.poly[it.after.poly.length - 1];
        else if (it.shot && it.carrier) {
          const cinfo = info[step.items.indexOf(it.carrier)];
          const cq = R.sampleAt(it.carrier.poly, Math.min(it.carrier.len, it.t0 * it.carrier.speed));
          src = { x: cq.x + cinfo.carryRel.dx, y: cq.y + cinfo.carryRel.dy };
        }
        const w = 1 - Math.min(1, u / BLEND);
        const bx = (src.x - it.poly[0].x) * w, by = (src.y - it.poly[0].y) * w;
        it.actors.forEach((id, k) => pos.set(id, { x: q.x + bx + info[n].offs[k].dx, y: q.y + by + info[n].offs[k].dy }));
        if (it.carry) pos.set(it.carry, { x: q.x + bx + info[n].carryRel.dx, y: q.y + by + info[n].carryRel.dy });
      });
    }
    return pos;
  };

  // ---------- plain-language record of what happens, step by step ----------
  A.describe = function (drill) {
    const tl = A.build(drill);
    const byId = new Map(drill.objects.map((o) => [o.id, o]));
    const nameOf = (id) => (byId.get(id) ? A.name(byId.get(id)) : '?');
    const near = (pt, types, r) => {
      let best = null, bd = r;
      for (const o of drill.objects) if (types.includes(o.type) && dist(o, pt) <= bd) { best = o; bd = dist(o, pt); }
      return best;
    };
    const steps = tl.steps.map((st) => ({
      step: st.step, start: st.start, dur: st.dur,
      lines: st.items.map((it) => {
        const who = it.actors.map(nameOf).join(' & ');
        if (!it.shot) {
          const verb = it.line.kind === 'back' ? 'skate' + (it.actors.length === 1 ? 's' : '') + ' backwards' : 'skate' + (it.actors.length === 1 ? 's' : '');
          return who + ' ' + verb + (it.carry ? ' carrying the puck' : '');
        }
        const end = it.poly[it.poly.length - 1];
        const when = it.after ? ' after the previous ' + (it.after.line.kind === 'pass' ? 'pass' : 'shot') + ' arrives'
          : it.carrier ? ' once ' + it.carrier.actors.map(nameOf).join(' & ') + ' reaches the start' : '';
        if (it.line.kind === 'pass') {
          const to = near(end, ['player'], 70);
          return 'Pass to ' + (to ? A.name(to) : 'open ice') + when;
        }
        return (near(end, ['net'], 90) ? 'Shot on net' : 'Shot') + when;
      }),
    }));
    return { steps, total: tl.total, unattached: A.unattached(drill) };
  };

  // ---------- playback controller ----------
  A.begin = function (drill) { A.drill = drill; A.tl = A.build(drill); return A.tl; };
  A.pose = () => (A.tl ? A.poseAt(A.drill, A.tl, A.t) : null);
  A.stepAt = () => {
    if (!A.tl) return -1;
    let idx = 0;
    A.tl.steps.forEach((s, i) => { if (A.t >= s.start) idx = i; });
    return idx;
  };

  function loop(now) {
    if (!A.playing) return;
    A.t += ((now - A.last) / 1000) * A.rate; A.last = now;
    if (A.t >= A.tl.total) { A.t = A.tl.total; A.playing = false; }
    A.onFrame();
    if (A.playing) A.raf = requestAnimationFrame(loop);
  }

  A.play = function (drill) {
    if (!A.tl) A.begin(drill);
    if (A.t >= A.tl.total) A.t = 0;
    A.playing = true; A.last = performance.now();
    cancelAnimationFrame(A.raf); A.raf = requestAnimationFrame(loop);
    A.onFrame();
  };
  A.pause = function () { A.playing = false; cancelAnimationFrame(A.raf); A.onFrame(); };
  A.seek = function (t) { A.t = clamp(t, 0, A.tl.total); A.onFrame(); };
  A.stop = function () { A.playing = false; cancelAnimationFrame(A.raf); A.tl = null; A.t = 0; A.onFrame(); };

  HD.anim = A;
})(window.HD = window.HD || {});
