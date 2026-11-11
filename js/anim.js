/* Drill animation.
 *
 * Data (stored on each motion line):  line.anim = { step: 1, actors: [objectId...], carry: puckId | null, speed: 1 }
 *   - sub: 1, 2, 3 = a, b, c. A step is global (everything in it starts together), but sub-steps are per player/puck:
 *     one player's (or puck's) motions in a step run a, then b, then c, each starting when the previous one ends,
 *     without affecting what any other player or puck is doing.
 *   - trigger (optional, same step only): { kind:'flag', flag:<flagId>, who:<pieceId>, delay } = start when that piece reaches
 *     the checkpoint flag; { kind:'motion', motion:<lineId>, when:'start'|'end', delay } = start when that motion starts / ends.
 *     A triggered motion starts at the later of "its player is free" and "the trigger fired". build() solves this by
 *     re-simulating the step with the trigger times as minimum start times until they settle.
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
    const byId = new Map(drill.objects.map((o) => [o.id, o]));
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

    const groups = new Map();                                // key = step (global)
    for (const l of usable(drill)) {
      const k = l.anim.step || 1;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }

    const steps = [];
    let clock = 0;
    for (const stepNo of [...groups.keys()].sort((a, b) => a - b)) {
      const lines = groups.get(stepNo);
      const startPos = new Map(rest);                        // snapshot: where everything is when this step begins
      const ownerIn = new Map(owner), relIn = new Map(rel);
      // sim(minStart): plays the whole step once. minStart = Map lineId -> earliest start (from triggers).
      const sim = (minStart) => {
      const owner = new Map(ownerIn), rel = new Map(relIn);
      const minOf = (l) => minStart.get(l.id) || 0;

      // ---- skating motions ----
      const movers = lines.filter((l) => !isShot(l)).map((l) => {
        const poly = R.flatten(l), len = R.polyLength(poly), speed = SPEED[l.kind] * clamp(l.anim.speed || 1, 0.25, 4);
        const actors = l.anim.actors.filter((id) => ids.has(id) && players.includes(id));
        return { line: l, sub: l.anim.sub || 1, poly, len, speed, dur: Math.max(0.3, len / speed), actors, carry: l.anim.carry && ids.has(l.anim.carry) ? l.anim.carry : null, carried: false };
      }).filter((m) => m.actors.length);
      // Each player/coach runs its own chain a -> b -> c: a motion starts when that player's previous motion ends
      // (all chains start together at the beginning of the step, independent of each other).
      movers.sort((a, b) => a.sub - b.sub);
      const segsOf = new Map();                              // player id -> its motions, in order
      const cur = new Map(startPos), free = new Map();       // where each player is / when it is free for its next motion
      for (const m of movers) {
        m.start = Math.max(minOf(m.line), ...m.actors.map((id) => free.get(id) || 0));
        m.lead = { ...cur.get(m.actors[0]) };
        m.offs = m.actors.map((id) => ({ dx: cur.get(id).x - m.lead.x, dy: cur.get(id).y - m.lead.y }));
        const e = m.poly[m.poly.length - 1];
        m.actors.forEach((id, i) => {
          cur.set(id, { x: e.x + m.offs[i].dx, y: e.y + m.offs[i].dy });
          free.set(id, m.start + m.dur);
          if (!segsOf.has(id)) segsOf.set(id, []);
          segsOf.get(id).push(m);
        });
      }
      // where a player/coach is at time t of this step (eases onto the start of its line first)
      const P = (id, t) => {
        const list = segsOf.get(id);
        let m = null;
        if (list) for (const x of list) if (x.start <= t) m = x;
        if (!m) return startPos.get(id);
        const u = clamp(t - m.start, 0, m.dur), q = R.sampleAt(m.poly, Math.min(m.len, (u / m.dur) * m.len));
        const w = 1 - Math.min(1, u / BLEND), i = m.actors.indexOf(id);
        return { x: q.x + (m.lead.x - m.poly[0].x) * w + m.offs[i].dx, y: q.y + (m.lead.y - m.poly[0].y) * w + m.offs[i].dy };
      };
      const Hm = Math.max(0, ...movers.map((m) => m.start + m.dur));

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
        return { line: l, sub: l.anim.sub || 1, poly, len, speed, dur: Math.max(0.3, len / speed), t0: 0, puck: l.anim.actors.find((id) => pucks.includes(id)), holder: null, receiver: null, warn: null };
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
          const minSub = Math.min(...todo.map((x) => x.sub));         // this puck's own chain: a before b before c
          for (const s of todo.filter((x) => x.sub === minSub)) {
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
          let fire = Math.max(f, tc, minOf(s.line));
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

      return { movers, shotItems, P, puckAt, stepEnd, owner, rel };
      };   // end of sim

      // ---- triggers: a motion may wait for a checkpoint or for another motion in this step ----
      const validTrig = (l) => {
        const t = l.anim.trigger;
        if (!t) return false;
        if (t.kind === 'flag') return byId.get(t.flag) && byId.get(t.flag).type === 'flag' && ids.has(t.who);
        if (t.kind === 'motion') return t.motion !== l.id && lines.some((x) => x.id === t.motion);
        return false;
      };
      const trigged = lines.filter(validTrig);
      const trigInfo = new Map();
      const trigTime = (l, res) => {
        const t = l.anim.trigger, delay = Math.max(0, +t.delay || 0);
        if (t.kind === 'motion') {
          const o = res.movers.find((m) => m.line.id === t.motion), s = res.shotItems.find((x) => x.line.id === t.motion);
          const a = o ? o.start : s ? s.t0 : null, d = o ? o.dur : s ? s.dur : 0;
          return a === null ? null : (t.when === 'end' ? a + d : a) + delay;
        }
        const f = byId.get(t.flag), isPuck = pucks.includes(t.who);
        let first = null, minD = Infinity, minT = 0;
        for (let tt = 0; ; tt += 1 / 30) {
          const q = Math.min(tt, res.stepEnd), p = isPuck ? res.puckAt(t.who, q) : res.P(t.who, q), d = dist(p, f);
          if (d < minD) { minD = d; minT = q; }
          if (d <= NEAR && first === null) first = q;
          if ((first !== null && d > minD + 0.5) || q >= res.stepEnd) break;     // came within range, now moving away: use the closest point
        }
        const when = first !== null || minD <= NEAR_LOOSE ? minT : null;
        return when === null ? null : when + delay;
      };
      let ms = new Map(), res = sim(ms);
      for (let it = 0; it < 8 && trigged.length; it++) {
        const next = new Map();
        for (const l of trigged) {
          const tt = trigTime(l, res);
          trigInfo.set(l.id, { warn: tt === null });
          if (tt !== null) next.set(l.id, tt);
        }
        if (trigged.every((l) => (next.get(l.id) || 0) === (ms.get(l.id) || 0))) break;
        ms = next; res = sim(ms);
      }
      const { movers, shotItems, P, puckAt, stepEnd } = res;
      for (const [k, v] of res.owner) owner.set(k, v);
      for (const [k, v] of res.rel) rel.set(k, v);

      // positions at the end of the step become the start of the next
      for (const m of movers) for (const id of m.actors) rest.set(id, { ...P(id, stepEnd) });
      for (const p of pucks) rest.set(p, { ...puckAt(p, stepEnd) });

      steps.push({ step: stepNo, label: String(stepNo), start: clock, dur: stepEnd, startPos, trig: trigInfo, movers, shots: shotItems.slice().sort((a, b) => a.t0 - b.t0), P, puckAt, pucks });
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
    const flagNo = (id) => drill.objects.filter((o) => o.type === 'flag').findIndex((o) => o.id === id) + 1;
    const WORD = { skate: 'skate', back: 'backwards skate', pass: 'pass', dump: 'dump', shoot: 'shot' };
    const trigText = (st, l) => {
      const t = l.anim.trigger, info = st.trig.get(l.id);
      if (!t || !info) return '';
      if (info.warn) return ' (waiting point never reached, so it starts with the step)';
      if (t.kind === 'flag') return ' - starts when ' + nameOf(t.who) + ' reaches checkpoint ' + flagNo(t.flag);
      const o = byId.get(t.motion), who = o && o.anim && o.anim.actors && o.anim.actors[0];
      return ' - starts when ' + (who ? nameOf(who) + '\u2019s ' : 'the ') + (o ? WORD[o.kind] : 'motion') + (t.when === 'end' ? ' ends' : ' begins');
    };
    const steps = tl.steps.map((st) => {
      const lines = [];
      const chain = (m, list, key) => (list.some((o) => o !== m && key(o).some((a) => key(m).includes(a))) ? String.fromCharCode(96 + Math.min(26, m.sub || 1)) + ': ' : '');
      for (const m of st.movers) {
        const who = m.actors.map(nameOf).join(' & '), one = m.actors.length === 1;
        lines.push(chain(m, st.movers, (o) => o.actors) + who + ' ' + (m.line.kind === 'back' ? 'skate' + (one ? 's' : '') + ' backwards' : 'skate' + (one ? 's' : '')) + (m.carried ? ' with the puck' : '') + trigText(st, m.line));
      }
      for (const s of st.shots) {
        const end = s.poly[s.poly.length - 1], pre = chain(s, st.shots, (o) => [o.puck]);
        const when = s.holder && !s.warn ? ' once ' + nameOf(s.holder) + ' has the puck at the start' : '';
        if (s.line.kind === 'pass') lines.push(pre + 'Pass to ' + (s.receiver ? nameOf(s.receiver) : 'open ice') + when + trigText(st, s.line));
        else if (s.line.kind === 'dump') lines.push(pre + 'Dump into open space' + when + trigText(st, s.line));
        else lines.push(pre + (near(end, ['net'], 90) ? 'Shot on net' : 'Shot') + when + trigText(st, s.line));
      }
      return { step: st.step, label: st.label, start: st.start, dur: st.dur, lines };
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
