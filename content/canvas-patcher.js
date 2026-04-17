// Runs in MAIN world at document_start.
// Patches CanvasRenderingContext2D.prototype.fillText to capture text fragment positions
// for the highlighting overlay. Fragments are stored per-canvas and cleared on full clearRect.
// Content scripts request data via CustomEvent 'docs-reviewer-request-fragments'.

(function () {
  'use strict';

  // Map from canvas element → fragment[]
  const canvasFragments = new Map();

  function serializeMatrix(ctx) {
    if (typeof ctx.getTransform !== 'function') {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    const matrix = ctx.getTransform();
    return {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      e: matrix.e,
      f: matrix.f,
    };
  }

  const origClearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
    // Full-canvas clear signals a new render cycle for this tile.
    if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) {
      canvasFragments.set(this.canvas, []);
    }
    return origClearRect.apply(this, arguments);
  };

  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
    if (text && text.trim().length > 0) {
      const canvas = this.canvas;
      let frags = canvasFragments.get(canvas);
      if (!frags) {
        frags = [];
        canvasFragments.set(canvas, frags);
      }
      frags.push({
        text,
        x,
        y,
        font: this.font,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        direction: this.direction,
        matrix: serializeMatrix(this),
      });
    }
    return origFillText.apply(this, arguments);
  };

  // Respond to content script fragment requests with serialized, viewport-resolved data.
  document.addEventListener('docs-reviewer-request-fragments', function () {
    const result = [];
    canvasFragments.forEach(function (frags, canvas) {
      if (!frags.length || !canvas.isConnected) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      result.push({
        canvasRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        canvasSize: {
          width: canvas.width,
          height: canvas.height,
        },
        fragments: frags.map(function (f) {
          return {
            text: f.text,
            x: f.x,
            y: f.y,
            font: f.font,
            textAlign: f.textAlign,
            textBaseline: f.textBaseline,
            direction: f.direction,
            matrix: f.matrix,
          };
        }),
      });
    });
    document.dispatchEvent(new CustomEvent('docs-reviewer-fragments-data', { detail: result }));
  });
})();
