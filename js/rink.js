/* Vector rink backgrounds.
 * World units: 1 unit = 0.1 ft. Full ice = 85ft x 200ft drawn portrait (850 x 2000).
 * Half ice = the lower (defensive-zone) half of the same rink (850 x 1000),
 * showing the blue line, neutral-zone dots, a slice of the centre circle, etc.
 * Drawn in code (not bitmaps) so the PDF export stays razor sharp. */
(function (HD) {
  'use strict';

  const W = 850, FULL_H = 2000, HALF_H = 1000;
  const RED = '#c8102e', BLUE = '#0033a0', ICE = '#f6fbff', CREASE = '#4db8ea';
  const CX = W / 2;

  function rinkPath(ctx) {
    const x0 = 4, x1 = W - 4, y0 = 4, y1 = FULL_H - 4, r = 280;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.arcTo(x1, y0, x1, y0 + r, r);
    ctx.lineTo(x1, y1 - r);
    ctx.arcTo(x1, y1, x1 - r, y1, r);
    ctx.lineTo(x0 + r, y1);
    ctx.arcTo(x0, y1, x0, y1 - r, r);
    ctx.lineTo(x0, y0 + r);
    ctx.arcTo(x0, y0, x0 + r, y0, r);
    ctx.closePath();
  }

  function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // One end of the rink, drawn at the top (y = 0 is the end boards).
  function drawEnd(ctx) {
    ctx.strokeStyle = RED; ctx.fillStyle = RED; ctx.lineWidth = 3;

    // goal line
    ctx.beginPath(); ctx.moveTo(0, 110); ctx.lineTo(W, 110); ctx.stroke();

    // trapezoid behind the net
    ctx.beginPath();
    ctx.moveTo(CX - 140, 0); ctx.lineTo(CX - 100, 110);
    ctx.moveTo(CX + 140, 0); ctx.lineTo(CX + 100, 110);
    ctx.stroke();

    // net
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.rect(CX - 30, 70, 60, 40); ctx.fill(); ctx.stroke();

    // crease
    ctx.fillStyle = CREASE;
    ctx.beginPath(); ctx.arc(CX, 110, 60, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();

    // face-off circles
    for (const sx of [-1, 1]) {
      const cx = CX + sx * 220, cy = 310;
      ctx.strokeStyle = RED; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 150, 0, Math.PI * 2); ctx.stroke();
      dot(ctx, cx, cy, 11, RED);
      // L-shaped hash marks around the dot
      for (const hx of [-1, 1]) for (const hy of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + hx * 20, cy + hy * 60);
        ctx.lineTo(cx + hx * 20, cy + hy * 25);
        ctx.lineTo(cx + hx * 60, cy + hy * 25);
        ctx.stroke();
      }
      // outer tick marks
      for (const tx of [-1, 1]) for (const ty of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + tx * 150, cy + ty * 12);
        ctx.lineTo(cx + tx * 185, cy + ty * 12);
        ctx.stroke();
      }
    }
  }

  function drawFullRink(ctx) {
    // ice
    ctx.save();
    rinkPath(ctx); ctx.fillStyle = ICE; ctx.fill();
    ctx.clip();

    // ends
    ctx.save(); drawEnd(ctx); ctx.restore();
    ctx.save(); ctx.translate(0, FULL_H); ctx.scale(1, -1); drawEnd(ctx); ctx.restore();

    // blue lines
    ctx.strokeStyle = BLUE; ctx.lineWidth = 14;
    for (const y of [750, 1250]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // centre red line (with the traditional white dashes)
    ctx.strokeStyle = RED; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(0, 1000); ctx.lineTo(W, 1000); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.setLineDash([10, 22]);
    ctx.beginPath(); ctx.moveTo(0, 1000); ctx.lineTo(W, 1000); ctx.stroke();
    ctx.setLineDash([]);

    // centre circle + dot
    ctx.strokeStyle = BLUE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(CX, 1000, 150, 0, Math.PI * 2); ctx.stroke();
    dot(ctx, CX, 1000, 9, BLUE);

    // neutral-zone face-off dots
    for (const sx of [-1, 1]) for (const y of [800, 1200]) dot(ctx, CX + sx * 220, y, 11, RED);
    ctx.restore();

    // boards
    rinkPath(ctx); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 8; ctx.stroke();
  }

  HD.RINK = {
    W,
    heightOf: (type) => (type === 'full' ? FULL_H : HALF_H),
    draw(ctx, type) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, this.heightOf(type));
      if (type === 'half') ctx.translate(0, -HALF_H);
      drawFullRink(ctx);
      ctx.restore();
    },
  };
})(window.HD = window.HD || {});
