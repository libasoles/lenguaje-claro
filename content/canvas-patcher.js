// Runs in MAIN world at document_start.
// Patches CanvasRenderingContext2D.prototype.fillText to capture text fragment positions
// for the highlighting overlay. Fragments are stored per-canvas and cleared on full clearRect.
// Content scripts request data via CustomEvent 'docs-reviewer-request-fragments'.

(function () {
  'use strict';

  const RENDER_BURST_GAP_MS = 40;
  const PREFIX = '[Legal Docs][CanvasPatcher]';

  // Map from canvas element → { fragments, lastWriteAt }
  const canvasStates = new Map();
  let renderNotificationTimer = null;

  // Snapshot of the last completed render burst with viewport-resolved positions.
  // Populated before dispatching 'canvas-rendered' so it's available even when the
  // content script (ISOLATED, document_idle) hasn't loaded yet or canvas tiles have
  // since been removed from the DOM by GDocs' tile virtualization.
  let lastRenderedSnapshot = null;

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

  function buildCanvasResult(canvas, state) {
    if (!state.fragments.length || !canvas.isConnected) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
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
      fragments: state.fragments.map(function (f) {
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
    };
  }

  function scheduleRenderNotification() {
    if (renderNotificationTimer) {
      clearTimeout(renderNotificationTimer);
    }

    renderNotificationTimer = setTimeout(function () {
      renderNotificationTimer = null;

      // Capture viewport-resolved snapshot NOW while canvas tiles are still connected.
      // This snapshot survives tile disconnection and is served as fallback when the
      // content script requests fragments after tiles have been recycled by GDocs.
      const snapshotResults = [];
      canvasStates.forEach(function (state, canvas) {
        const result = buildCanvasResult(canvas, state);
        if (result) snapshotResults.push(result);
      });
      if (snapshotResults.length > 0) {
        lastRenderedSnapshot = {
          canvasResults: snapshotResults,
          timestamp: getNow(),
        };
      }

      let totalFragments = 0;
      canvasStates.forEach(function (state) {
        totalFragments += state.fragments.length;
      });
      console.log(PREFIX, {
        stage: 'canvas-rendered',
        canvases: canvasStates.size,
        totalFragments,
        snapshotCanvases: snapshotResults.length,
        renderedAt: getNow(),
      });
      document.dispatchEvent(
        new CustomEvent('docs-reviewer-canvas-rendered', {
          detail: {
            renderedAt: getNow(),
            canvases: canvasStates.size,
            totalFragments,
          },
        }),
      );
    }, RENDER_BURST_GAP_MS);
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
      scheduleRenderNotification();
    }
    return origFillText.apply(this, arguments);
  };

  // Respond to content script fragment requests with serialized, viewport-resolved data.
  document.addEventListener('docs-reviewer-request-fragments', function () {
    const result = [];
    canvasStates.forEach(function (state, canvas) {
      const r = buildCanvasResult(canvas, state);
      if (r) result.push(r);
    });

    // If no connected canvas tiles have data (GDocs may have recycled them),
    // fall back to the last rendered snapshot captured when tiles were still connected.
    if (result.length === 0 && lastRenderedSnapshot) {
      result.push.apply(result, lastRenderedSnapshot.canvasResults);
      console.log(PREFIX, {
        stage: 'snapshot-fallback',
        canvases: result.length,
        snapshotAge: getNow() - lastRenderedSnapshot.timestamp,
      });
    }

    const totalFragments = result.reduce(function (sum, canvasData) {
      return sum + canvasData.fragments.length;
    }, 0);
    console.log(PREFIX, {
      stage: 'fragments-requested',
      canvases: result.length,
      totalFragments,
    });
    if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
      window.postMessage(
        {
          source: 'docs-reviewer-canvas-patcher',
          type: 'docs-reviewer-fragments-data',
          detail: result,
        },
        '*',
      );
    }
    document.dispatchEvent(new CustomEvent('docs-reviewer-fragments-data', { detail: result }));
  });
})();
