/* Project data, undo/redo and persistence (localStorage autosave + JSON file save/open). */
(function (HD) {
  'use strict';

  const KEY = 'hockey-drill-designer:v1';
  let uid = Date.now();
  const newId = () => 'o' + (uid++).toString(36);

  function newDrill(rink, name) {
    return { id: newId(), name: name || 'Untitled drill', notes: '', rink: rink || 'half', objects: [] };
  }

  const S = {
    project: null,
    current: null,       // current drill
    history: new Map(),  // drill id -> { undo: [], redo: [] }
    listeners: new Set(),
    trash: [],           // files of deleted drills, removed from the Drills folder on next sync

    init() {
      let loaded = null;
      try { loaded = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
      this.setProject(loaded && loaded.drills && loaded.drills.length ? loaded : { version: 1, drills: [newDrill('half', 'Drill 1')], currentId: null });
    },

    setProject(p) {
      this.project = p;
      this.history.clear();
      this.current = p.drills.find((d) => d.id === p.currentId) || p.drills[0];
      this.emit('project');
    },

    onChange(fn) { this.listeners.add(fn); },
    emit(kind) {
      this.project.currentId = this.current.id;
      this.save();
      this.listeners.forEach((fn) => fn(kind));
    },

    save(skipFolder) {
      try { localStorage.setItem(KEY, JSON.stringify(this.project)); } catch (e) { /* storage full / blocked */ }
      if (!skipFolder && HD.fs) HD.fs.schedule();
    },

    // ----- history -----
    hist(d) {
      d = d || this.current;
      if (!this.history.has(d.id)) this.history.set(d.id, { undo: [], redo: [] });
      return this.history.get(d.id);
    },
    snapshot() { return JSON.stringify({ objects: this.current.objects, rink: this.current.rink }); },
    // Call BEFORE mutating the drill.
    checkpoint() {
      const h = this.hist();
      h.undo.push(this.snapshot()); if (h.undo.length > 200) h.undo.shift();
      h.redo.length = 0;
    },
    restore(json) {
      const s = JSON.parse(json);
      this.current.objects = s.objects; this.current.rink = s.rink;
    },
    undo() {
      const h = this.hist(); if (!h.undo.length) return false;
      h.redo.push(this.snapshot()); this.restore(h.undo.pop()); this.emit('objects'); return true;
    },
    redo() {
      const h = this.hist(); if (!h.redo.length) return false;
      h.undo.push(this.snapshot()); this.restore(h.redo.pop()); this.emit('objects'); return true;
    },
    canUndo() { return this.hist().undo.length > 0; },
    canRedo() { return this.hist().redo.length > 0; },

    // ----- drills -----
    selectDrill(id) { this.current = this.project.drills.find((d) => d.id === id) || this.current; this.emit('drill'); },
    addDrill(rink) {
      const d = newDrill(rink || this.current.rink, 'Drill ' + (this.project.drills.length + 1));
      this.project.drills.push(d); this.current = d; this.emit('drill');
    },
    duplicateDrill() {
      const copy = JSON.parse(JSON.stringify(this.current));
      copy.id = newId(); copy.name += ' copy';
      const i = this.project.drills.indexOf(this.current);
      this.project.drills.splice(i + 1, 0, copy); this.current = copy; this.emit('drill');
    },
    deleteDrill() {
      const ds = this.project.drills;
      if (ds.length === 1) { this.checkpoint(); this.current.objects = []; this.emit('objects'); return; }
      const i = ds.indexOf(this.current);
      if (this.current.file) this.trash.push(this.current.file);
      ds.splice(i, 1); this.history.delete(this.current.id);
      this.current = ds[Math.min(i, ds.length - 1)]; this.emit('drill');
    },
    moveDrill(dir) {
      const ds = this.project.drills, i = ds.indexOf(this.current), j = i + dir;
      if (j < 0 || j >= ds.length) return;
      [ds[i], ds[j]] = [ds[j], ds[i]]; this.emit('drill');
    },

    // Adds drills loaded from the Drills folder (skips ones already in the project).
    addLoaded(list) {
      let added = 0;
      for (const { file, drill } of list) {
        if (this.project.drills.some((d) => d.id === drill.id)) continue;
        drill.file = file; drill.objects = drill.objects || []; drill.rink = drill.rink || 'half'; drill.notes = drill.notes || '';
        this.project.drills.push(drill); added++;
      }
      if (added) { this.current = this.project.drills[this.project.drills.length - added]; this.emit('drill'); }
      return added;
    },

    // ----- files -----
    toFileJSON() { this.project.currentId = this.current.id; return JSON.stringify(this.project, null, 1); },
    loadFileJSON(text) {
      const p = JSON.parse(text);
      if (!p || !Array.isArray(p.drills) || !p.drills.length) throw new Error('Not a drill file');
      p.drills.forEach((d) => { d.id = d.id || newId(); d.objects = d.objects || []; d.rink = d.rink || 'half'; d.notes = d.notes || ''; d.name = d.name || 'Untitled drill'; });
      this.setProject(p);
    },
  };

  HD.newId = newId;
  HD.store = S;
})(window.HD = window.HD || {});
