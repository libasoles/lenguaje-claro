// Runs in MAIN world at document_start.
// Patches CanvasRenderingContext2D.prototype.fillText to capture text fragment positions
// for the highlighting overlay. Fragments are stored per-canvas and cleared on full clearRect.
// Content scripts request data via CustomEvent 'docs-reviewer-request-fragments'.

(function () {
  'use strict';

  const RENDER_BURST_GAP_MS = 40;

  // Map from canvas element → { fragments, lastWriteAt }
  const canvasStates = new Map();

  function getNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }

    return Date.now();
  }

  function ensureCanvasState(canvas) {
    let state = canvasStates.get(canvas);
    if (!state) {
      state = {
        fragments: [],
        lastWriteAt: -Infinity,
      };
      canvasStates.set(canvas, state);
    }
    return state;
  }

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
      const state = ensureCanvasState(this.canvas);
      state.fragments = [];
      state.lastWriteAt = -Infinity;
    }
    return origClearRect.apply(this, arguments);
  };

  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
    if (text && text.trim().length > 0) {
      const canvas = this.canvas;
      const state = ensureCanvasState(canvas);
      const now = getNow();

      // Google Docs frequently redraws the same canvas after edits/reflow
      // without a full clearRect. Treat temporally separated fillText bursts
      // as a fresh snapshot so old positions do not linger indefinitely.
      if (now - state.lastWriteAt > RENDER_BURST_GAP_MS) {
        state.fragments = [];
      }
      state.lastWriteAt = now;
      state.fragments.push({
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
    canvasStates.forEach(function (state, canvas) {
      const frags = state.fragments;
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
