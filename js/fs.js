/* Local-folder saving via Chrome's File System Access API.
 * Two independent folders, each picked once and remembered (handles live in IndexedDB):
 *   - "drills":  one <name>.drill.json per drill, auto-saved
 *   - "exports": exported PDFs
 * The folders can be anywhere (e.g. the project's Drills/ and Exports/ folders, or elsewhere). */
(function (HD) {
  'use strict';
  const S = HD.store;
  const DB = 'hockey-drill-designer-fs', STORE = 'handles';
  const KINDS = ['drills', 'exports'];

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
  }

  const safeName = (n) => (n || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled drill';

  const F = {
    supported: typeof window.showDirectoryPicker === 'function',
    handles: { drills: null, exports: null },
    states: { drills: 'none', exports: 'none' },   // none | needs-permission | ready
    status: 'idle',                                // drills auto-save: idle | saving | saved | error
    onState: () => {},
    written: new Map(),                            // drill id -> last JSON written
    timer: null,
    chain: Promise.resolve(),
  };
  // convenience for the drills folder (auto-save)
  Object.defineProperty(F, 'state', { get: () => F.states.drills });

  function emitState() { F.onState(); }

  F.restore = async function () {
    if (!F.supported) return;
    for (const k of KINDS) {
      try {
        const h = await idbOp('readonly', (s) => s.get(k));
        if (!h) continue;
        F.handles[k] = h;
        F.states[k] = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ready' : 'needs-permission';
      } catch (e) { /* nothing stored */ }
    }
    emitState();
    F.schedule();
  };

  // Must be called from a click (user gesture).
  F.connect = async function (kind) {
    if (!F.supported) return false;
    try {
      const have = F.handles[kind];
      if (have && F.states[kind] === 'needs-permission') {
        if ((await have.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
      } else {
        const other = F.handles[kind === 'drills' ? 'exports' : 'drills'];
        // Chrome can't open at an arbitrary path: start next to the other folder, else in Documents.
        const h = await window.showDirectoryPicker({ id: 'hd-' + kind, mode: 'readwrite', startIn: have || other || 'documents' });
        F.handles[kind] = h;
        if (kind === 'drills') F.written.clear();
        await idbOp('readwrite', (s) => s.put(h, kind));
      }
      F.states[kind] = 'ready';
      if (kind === 'drills') F.status = 'idle';
      emitState();
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return false;
    }
  };

  F.disconnect = async function (kind) {
    F.handles[kind] = null; F.states[kind] = 'none';
    if (kind === 'drills') F.written.clear();
    try { await idbOp('readwrite', (s) => s.delete(kind)); } catch (e) { /* ignore */ }
    emitState();
  };

  F.name = (kind) => (F.handles[kind] ? F.handles[kind].name : '');

  F.writeFile = async function (kind, fileName, data) {
    const fh = await F.handles[kind].getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(data); await w.close();
  };

  async function readDrillFiles(dir, out) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.drill.json')) continue;
      try {
        const f = await h.getFile();
        const j = JSON.parse(await f.text());
        if (j && j.drill) out.push({ file: name, order: j.order || 0, drill: j.drill, modified: f.lastModified });
      } catch (e) { /* skip unreadable file */ }
    }
  }

  // Drills saved in the drills folder: [{ file, order, drill }].
  // Also reads a "Drills" subfolder if an early version of the app created one. Nothing is moved or deleted.
  F.listDrills = async function () {
    const all = [];
    await readDrillFiles(F.handles.drills, all);
    try { await readDrillFiles(await F.handles.drills.getDirectoryHandle('Drills'), all); } catch (e) { /* none */ }
    const newest = new Map();
    for (const it of all) {
      const cur = newest.get(it.drill.id);
      if (!cur || it.modified > cur.modified) newest.set(it.drill.id, it);
    }
    return [...newest.values()].sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
  };

  // True if a file with this name exists and does NOT hold the given drill (so we must not overwrite it).
  async function belongsToOther(name, id) {
    let fh;
    try { fh = await F.handles.drills.getFileHandle(name); } catch (e) { return false; }   // doesn't exist
    try { const j = JSON.parse(await (await fh.getFile()).text()); return !(j && j.drill && j.drill.id === id); }
    catch (e) { return true; }                                                              // unreadable: leave it alone
  }

  // ---------- auto-save (drills folder) ----------
  F.schedule = function () {
    if (F.state !== 'ready') return;
    clearTimeout(F.timer);
    F.timer = setTimeout(F.syncNow, 700);
  };

  F.syncNow = function () {
    clearTimeout(F.timer);
    if (F.state !== 'ready') return F.chain;
    F.chain = F.chain.then(sync).catch((e) => {
      console.error(e);
      if (e.name === 'NotAllowedError') F.states.drills = 'needs-permission';
      F.status = 'error'; emitState();
    });
    return F.chain;
  };

  async function sync() {
    F.status = 'saving'; emitState();
    const drills = S.project.drills, taken = new Set();
    for (let i = 0; i < drills.length; i++) {
      const d = drills[i];
      const base = safeName(d.name);
      let name = d.file && safeName(d.file.replace(/\.drill\.json$/, '')) === base ? d.file : base + '.drill.json', n = 2;
      // pick a free name: not used by another drill in the project, and not a file that belongs to some other drill
      while (taken.has(name.toLowerCase()) || (name !== d.file && await belongsToOther(name, d.id))) name = base + ' (' + n++ + ').drill.json';
      taken.add(name.toLowerCase());

      const { file, ...rest } = d;
      const json = JSON.stringify({ app: 'hockey-drill-designer', version: 1, order: i, drill: rest }, null, 1);
      if (file !== name || F.written.get(d.id) !== json) {
        await F.writeFile('drills', name, json);
        d.file = name; F.written.set(d.id, json);     // a renamed drill leaves its old file in place (we never delete)
      }
    }
    S.trash.length = 0;
    S.save(true);
    F.status = 'saved'; emitState();
  }

  F.safeName = safeName;
  HD.fs = F;
})(window.HD = window.HD || {});
