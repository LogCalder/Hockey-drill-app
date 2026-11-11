/* PDF export (US Letter, portrait). Drills are rendered with the same drawing code as the editor.
 * On every page all drills share ONE scale, so pieces keep identical visual size across a sheet. */
(function (HD) {
  'use strict';

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 36;   // points
  const GAP = 18;

  function renderDrillImage(drill, ptPerUnit) {
    const W = HD.RINK.W, H = HD.RINK.heightOf(drill.rink);
    let pxPerPt = 3.2;                                // ~230 dpi
    const maxDim = 4800;
    pxPerPt = Math.min(pxPerPt, maxDim / (Math.max(W, H) * ptPerUnit));
    const k = ptPerUnit * pxPerPt;
    const c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    HD.R.drawDrill(ctx, drill, { zoom: 1 });
    return c.toDataURL('image/png');
  }

  function gridFor(chunk, perPage) {
    if (perPage === 1) return { cols: 1, rows: 1 };
    if (perPage === 2) return chunk.every((d) => d.rink === 'full') ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    return { cols: 2, rows: 2 };
  }

  HD.exportPDF = function (opts) {
    const { jsPDF } = window.jspdf;
    const S = HD.store;
    const drills = opts.scope === 'current' ? [S.current] : S.project.drills;
    const perPage = opts.perPage;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });

    for (let start = 0; start < drills.length; start += perPage) {
      const chunk = drills.slice(start, start + perPage);
      if (start > 0) doc.addPage('letter', 'portrait');
      const { cols, rows } = gridFor(chunk, perPage);
      const cw = (PAGE_W - 2 * MARGIN - GAP * (cols - 1)) / cols;
      const ch = (PAGE_H - 2 * MARGIN - GAP * (rows - 1)) / rows;

      // text blocks (title above, notes below) are measured first so the image area is known
      const cells = chunk.map((d) => {
        const titleH = opts.titles ? 22 : 0;     // (notes/steps are measured below)
        let notes = [];
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        if (opts.titles && d.notes && d.notes.trim()) notes = doc.splitTextToSize(d.notes.trim(), cw);
        if (opts.steps && HD.anim.hasMotions(d)) {               // the animation written out as numbered steps
          for (const st of HD.anim.describe(d).steps) {
            notes = notes.concat(doc.splitTextToSize('Step ' + st.label + ': ' + st.lines.join('; ') + '.', cw));
          }
        }
        notes = notes.slice(0, perPage === 1 ? 26 : perPage === 2 ? 12 : 8);
        const notesH = notes.length ? notes.length * 11 + 6 : 0;
        return { d, titleH, notes, notesH, imgH: ch - titleH - notesH };
      });

      // one shared scale for the whole sheet
      const scale = Math.min(...cells.map((c) => Math.min(cw / HD.RINK.W, c.imgH / HD.RINK.heightOf(c.d.rink))));

      cells.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x0 = MARGIN + col * (cw + GAP), y0 = MARGIN + row * (ch + GAP);
        const iw = HD.RINK.W * scale, ih = HD.RINK.heightOf(c.d.rink) * scale;
        const ix = x0 + (cw - iw) / 2;
        let y = y0;
        if (c.titleH) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20);
          doc.text(c.d.name || 'Untitled drill', x0 + cw / 2, y + 14, { align: 'center', maxWidth: cw });
          y += c.titleH;
        }
        doc.addImage(renderDrillImage(c.d, scale), 'PNG', ix, y, iw, ih, undefined, 'FAST');
        y += ih + (c.notesH ? 6 : 0);
        if (c.notes.length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50);
          c.notes.forEach((line, n) => doc.text(line, x0 + cw / 2, y + 8 + n * 11, { align: 'center' }));
        }
      });
    }

    const base = (opts.filename || 'hockey-drills').replace(/[^\w\- ]+/g, '').trim() || 'hockey-drills';
    return { blob: doc.output('blob'), name: base + '.pdf' };
  };
})(window.HD = window.HD || {});
