/* Drill animation.
 *
 * Data (stored on each motion line):  line.anim = { step: 1, actors: [objectId...], carry: puckId | null, speed: 1 }
 *   - skate / back lines: actors are players (or the coach); they follow the path.
 *     `carry` (optional) says "this puck moves with them" - otherwise possession is worked out automatically.
 *   - pass / shoot lines: actors are pucks; they travel along the line.
 *
 * POSSESSION MODEL. A puck is always either held by a player/coach, loose, or in flight.
 *   - A held puck moves with its holder (so a puck can only travel on a skating line with a player/coach).
 *   - A pass/shot waits for its holder to reach the start of that line, but ONLY within its own step: if the holder
 *     never gets there during this step (or nobody holds the puck), the pass/shot simply happens in its step.
 *   - A pass lands where it was drawn; the player/coach who is there (or skates through there) receives it and
 *     the puck then moves with them, so the next shot waits until that player and puck have both arrived. If nobody
 *     reaches the landing spot during the step, the puck stays loose there (a later step can pick it up).
 *   - Initially a puck is held by a player standing right next to it.
 * Motions with the same step play together; steps play one after another. Playback never edits the drill:
 * build() simulates the possession once, poseAt() just reads positions for any time t.
 */
(function (HD) {
  'use strict';
  const R = HD.R;
  const SPEED = { skate: 320, back: 230, pass: 480, dump: 650, shoot: 900 };    // world units (0.1 ft) per second
  const GAP = 0.25;            // pause between steps (s)
  const BLEND = 0.3;           // s: pieces ease onto their line / onto their new holder (no teleporting)
  const REL = { dx: 45, dy: 30 };  // where a held puck sits relative to its holder (clear of the player's circle)
  const MIN_REL = 54;          // never closer than this, so there is always white space between player and puck
  const LEAD = 0.25;           // a pass lands this long before its receiver gets there
  const relOf = (dx, dy) => { const l = Math.hypot(dx, dy); return l < 1e-6 ? REL : l >= MIN_REL ? { dx, dy } : { dx: (dx / l) * MIN_REL, dy: (dy / l) * MIN_REL }; };
  const NEAR = 45;             // "arrived" distance
  const NEAR_LOOSE = 110;      // a pass can be received/started by someone passing this close (leading a pass)
  const START_OWN = 60;        // a puck right next to a player at the start is theirs
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isShot = (l) => l.kind === 'pass' || l.kind === 'dump' || l.kind === 'shoot';
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
    const rest = new Map();                                  // id -> position at the start of the current step
    for (const o of drill.objects) if (o.type !== 'line') rest.set(o.id, { x: o.x, y: o.y });
    const players = drill.objects.filter((o) => o.type === 'player').map((o) => o.id);
    const pucks = drill.objects.filter((o) => o.type === 'puck').map((o) => o.id);

    // who holds each puck at the very start (a player standing right next to it)
    const owner = new Map(), rel = new Map();
    for (const p of pucks) {
      let best = null, bd = START_OWN;
      for (const id of players) { const d = dist(rest.get(id), rest.get(p)); if (d <= bd) { best = id; bd = d; } }
      owner.set(p, best);
      rel.set(p, best ? relOf(rest.get(p).x - rest.get(best).x, rest.get(p).y - rest.get(best).y) : REL);
    }

    const groups = new Map();
    for (const l of usable(drill)) {
      const k = l.anim.step || 1;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }

    const steps = [];
    let clock = 0;
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      const lines = groups.get(k);
      const startPos = new Map(rest);                        // snapshot: where everything is when this step begins

      // ---- skating motions ----
      const movers = lines.filter((l) => !isShot(l)).map((l) => {
        const poly = R.flatten(l), len = R.polyLength(poly), speed = SPEED[l.kind] * clamp(l.anim.speed || 1, 0.25, 4);
        const actors = l.anim.actors.filter((id) => ids.has(id) && players.includes(id));
        return { line: l, poly, len, speed, dur: Math.max(0.3, len / speed), actors, carry: l.anim.carry && ids.has(l.anim.carry) ? l.anim.carry : null, carried: false };
      }).filter((m) => m.actors.length);
      const moverOf = new Map();
      for (const m of movers) {
        m.lead = startPos.get(m.actors[0]);
        m.offs = m.actors.map((id) => ({ dx: startPos.get(id).x - m.lead.x, dy: startPos.get(id).y - m.lead.y }));
        for (const id of m.actors) if (!moverOf.has(id)) moverOf.set(id, m);
      }
      // where a player/coach is at time t of this step (eases onto the start of its line first)
      const P = (id, t) => {
        const m = moverOf.get(id);
        if (!m) return startPos.get(id);
        const u = clamp(t, 0, m.dur), q = R.sampleAt(m.poly, Math.min(m.len, (u / m.dur) * m.len));
        const w = 1 - Math.min(1, u / BLEND), i = m.actors.indexOf(id);
        return { x: q.x + (m.lead.x - m.poly[0].x) * w + m.offs[i].dx, y: q.y + (m.lead.y - m.poly[0].y) * w + m.offs[i].dy };
      };
      const Hm = Math.max(0, ...movers.map((m) => m.dur));

      // closest approach / first arrival of a player to a point, from time t0 on
      const approach = (id, pt, t0) => {
        let first = null, minD = Infinity, minT = t0;
        const hor = Math.max(t0, Hm);
        for (let t = t0; ; t += 1 / 30) {
          const tt = Math.min(t, hor), d = dist(P(id, tt), pt);
          if (d < minD) { minD = d; minT = tt; }
          if (first === null && d <= NEAR) first = tt;
          if (tt >= hor) break;
        }
        return { first, minD, minT };
      };
      // who gets a loose puck at `pt` from time t0 (a player there, or skating through there)
      const claim = (pt, t0, exclude, generous) => {
        let best = null;
        for (const id of players) {
          if (id === exclude) continue;
          const a = approach(id, pt, t0);
          let cand = null;
          if (a.first !== null) cand = { id, t: a.first, tier: 0, d: a.minD };
          else if (generous && a.minD <= NEAR_LOOSE) cand = { id, t: a.minT, tier: 1, d: a.minD };
          if (!cand) continue;
          if (!best || cand.tier < best.tier || (cand.tier === best.tier && (cand.tier === 0 ? cand.t < best.t : cand.d < best.d))) best = cand;
        }
        return best;
      };

      const evalSeg = (seg, t) => {
        if (seg.type === 'loose') return seg.pos;
        if (seg.type === 'carry') {
          const q = P(seg.owner, t), q0 = P(seg.owner, seg.t0), w = 1 - Math.min(1, (t - seg.t0) / BLEND);
          return { x: q.x + seg.rel.dx + (seg.from.x - (q0.x + seg.rel.dx)) * w, y: q.y + seg.rel.dy + (seg.from.y - (q0.y + seg.rel.dy)) * w };
        }
        const it = seg.item, u = clamp(t - seg.t0, 0, it.dur), q = R.sampleAt(it.poly, Math.min(it.len, (u / it.dur) * it.len));
        const w = 1 - Math.min(1, u / BLEND);
        return { x: q.x + (seg.from.x - it.poly[0].x) * w, y: q.y + (seg.from.y - it.poly[0].y) * w };
      };

      // explicit "carrying a puck" on a skating line: that puck is with that player from the start of the step
      for (const m of movers) if (m.carry && owner.get(m.carry) !== m.actors[0]) {
        const lead = m.actors[0], d = dist(rest.get(m.carry), rest.get(lead));
        owner.set(m.carry, lead);
        rel.set(m.carry, d < 90 ? relOf(rest.get(m.carry).x - rest.get(lead).x, rest.get(m.carry).y - rest.get(lead).y) : REL);
      }

      // ---- passes / shots, puck by puck ----
      const shotItems = lines.filter(isShot).map((l) => {
        const poly = R.flatten(l), len = R.polyLength(poly), speed = SPEED[l.kind] * clamp(l.anim.speed || 1, 0.25, 4);
        return { line: l, poly, len, speed, dur: Math.max(0.3, len / speed), t0: 0, puck: l.anim.actors.find((id) => pucks.includes(id)), holder: null, receiver: null, warn: null };
      }).filter((s) => s.puck);
      let stepEnd = Hm;
      const segs = new Map();
      for (const p of pucks) {
        let own = owner.get(p), L = { ...rest.get(p) }, tc = 0;
        const relv = rel.get(p) || REL;
        const list = [];
        if (own) list.push({ type: 'carry', t0: 0, owner: own, rel: relv, from: { ...rest.get(p) } });
        else {
          list.push({ type: 'loose', t0: 0, pos: L });
          const c = claim(L, 0, null, false);                  // someone skating over a loose puck picks it up
          if (c) { list.push({ type: 'carry', t0: c.t, owner: c.id, rel: REL, from: L }); own = c.id; tc = c.t; }
        }
        const puckNow = (t) => evalSeg(list[list.length - 1], t);
        let todo = shotItems.filter((s) => s.puck === p);
        while (todo.length) {
          // when could each remaining pass/shot fire? (its holder reaching its start, or nearby if nobody holds it)
          let best = null;
          for (const s of todo) {
            let f, warn = null;
            if (own) {
              const a = approach(own, s.poly[0], tc);
              if (a.first !== null) f = a.first;
              else if (a.minD <= NEAR_LOOSE) f = a.minT;
              else { f = tc; warn = 'start'; }          // holder never gets there in this step: it just happens
            } else if (dist(L, s.poly[0]) <= NEAR_LOOSE) f = tc;
            else { f = tc; warn = 'nobody'; }
            const w = warn ? 1 : 0;
            if (!best || w < best.w || (w === best.w && f < best.f)) best = { s, f, warn, w };
          }
          const { s, f, warn } = best;
          todo = todo.filter((x) => x !== s);
          let fire = Math.max(f, tc);
          if (s.line.kind === 'pass') {
            // time the pass so it lands just before whoever receives it gets there (a dump/shot just goes)
            const c0 = claim(s.poly[s.poly.length - 1], fire + s.dur, own, true);
            if (c0) {
              let latest = fire;                                  // ...but only while the holder is still at the start
              if (own) for (let t = fire; t <= Math.max(fire, Hm); t += 1 / 30) { if (dist(P(own, t), s.poly[0]) > NEAR_LOOSE) break; latest = t; }
              else latest = Math.max(fire, Hm);
              fire = Math.min(Math.max(fire, c0.t - LEAD - s.dur), Math.max(fire, latest));
            }
          }
          s.t0 = fire; s.holder = own; s.warn = warn;
          list.push({ type: 'flight', t0: s.t0, item: s, from: puckNow(s.t0) });
          const arrive = s.t0 + s.dur, end = s.poly[s.poly.length - 1];
          stepEnd = Math.max(stepEnd, arrive);
          L = { ...end }; own = null; tc = arrive;
          list.push({ type: 'loose', t0: arrive, pos: L });
          if (s.line.kind === 'pass') {                         // the receiver takes it; shots just end where they end
            const c = claim(end, arrive, s.holder, true);
            if (c) {
              s.receiver = c.id; list.push({ type: 'carry', t0: Math.max(c.t, arrive), owner: c.id, rel: REL, from: { ...end } });
              own = c.id; tc = Math.max(c.t, arrive); stepEnd = Math.max(stepEnd, tc + BLEND);
            }
          }
        }
        segs.set(p, list);
        owner.set(p, own); rel.set(p, own ? (list[list.length - 1].rel || REL) : REL);
      }

      for (const m of movers) for (const p of pucks) if ((segs.get(p) || []).some((s) => s.type === 'carry' && m.actors.includes(s.owner))) m.carried = true;

      // where a puck is at time t of this step
      const puckAt = (p, t) => {
        const list = segs.get(p);
        let seg = list[0];
        for (const x of list) if (x.t0 <= t) seg = x;
        return evalSeg(seg, t);
      };

      // positions at the end of the step become the start of the next
      for (const m of movers) for (const id of m.actors) rest.set(id, { ...P(id, stepEnd) });
      for (const p of pucks) rest.set(p, { ...puckAt(p, stepEnd) });

      steps.push({ step: k, start: clock, dur: stepEnd, startPos, movers, shots: shotItems.slice().sort((a, b) => a.t0 - b.t0), P, puckAt, pucks });
      clock += stepEnd + GAP;
    }
    return { steps, total: Math.max(0.01, clock - GAP) };
  };

  // Position of every piece at time t. Returns Map id -> {x, y}.
  A.poseAt = function (drill, tl, t) {
    const pos = new Map();
    for (const o of drill.objects) if (o.type !== 'line') pos.set(o.id, { x: o.x, y: o.y });
    let step = null;
    for (const st of tl.steps) if (t >= st.start) step = st;
    if (!step) return pos;
    for (const [id, p] of step.startPos) pos.set(id, p);
    const local = t - step.start;
    for (const m of step.movers) for (const id of m.actors) pos.set(id, step.P(id, local));
    for (const p of step.pucks) pos.set(p, step.puckAt(p, local));
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
    const steps = tl.steps.map((st) => {
      const lines = [];
      for (const m of st.movers) {
        const who = m.actors.map(nameOf).join(' & '), one = m.actors.length === 1;
        lines.push(who + ' ' + (m.line.kind === 'back' ? 'skate' + (one ? 's' : '') + ' backwards' : 'skate' + (one ? 's' : '')) + (m.carried ? ' with the puck' : ''));
      }
      for (const s of st.shots) {
        const end = s.poly[s.poly.length - 1];
        const when = s.holder && !s.warn ? ' once ' + nameOf(s.holder) + ' has the puck at the start' : '';
        if (s.line.kind === 'pass') lines.push('Pass to ' + (s.receiver ? nameOf(s.receiver) : 'open ice') + when);
        else if (s.line.kind === 'dump') lines.push('Dump into open space' + when);
        else lines.push((near(end, ['net'], 90) ? 'Shot on net' : 'Shot') + when);
      }
      return { step: st.step, start: st.start, dur: st.dur, lines };
    });
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
