// Runs in MAIN world at document_start.
// Patches CanvasRenderingContext2D.prototype.fillText to capture text fragment positions
// for the highlighting overlay. Fragments are stored per-canvas and cleared on full clearRect.
// Content scripts request data via CustomEvent 'docs-reviewer-request-fragments'.

(function () {
  "use strict";

  const RENDER_NOTIFICATION_DEBOUNCE_MS = 40;
  // Umbral para considerar que una nueva ráfaga de fillText pertenece a un
  // ciclo de render distinto y por tanto debe descartar los fragments previos
  // del canvas. Debe ser lo bastante alto para que líneas consecutivas de un
  // mismo párrafo no se dibujen en ráfagas separadas (GDocs a veces las emite
  // con 100+ ms entre medias), pero lo bastante bajo para descartar fragments
  // stale tras una edición sin clearRect.
  const RENDER_BURST_GAP_MS = 300;
  // Tolerancia para considerar que dos fragments están en la misma posición
  // y, por tanto, el nuevo debe reemplazar al viejo (redibujado del mismo
  // glyph slot con texto distinto).
  const SAME_POSITION_EPSILON = 0.5;

  // Map from canvas element → { fragments, lastWriteAt }
  const canvasStates = new Map();
  let renderNotificationTimer = null;
  let viewportScrollGeneration = 0;

  // Snapshot of the last completed render burst with viewport-resolved positions.
  // Populated before dispatching 'canvas-rendered' so it's available even when the
  // content script (ISOLATED, document_idle) hasn't loaded yet or canvas tiles have
  // since been removed from the DOM by GDocs' tile virtualization.
  let lastRenderedSnapshot = null;

  function getNow() {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
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
        parentPosAtLastWrite: null,
        viewportScrollGenerationAtLastWrite: viewportScrollGeneration,
      };
      canvasStates.set(canvas, state);
    }
    return state;
  }

  function resetCanvasState(state) {
    state.fragments = [];
    state.lastWriteAt = -Infinity;
    state.parentPosAtLastWrite = null;
    state.viewportScrollGenerationAtLastWrite = viewportScrollGeneration;
  }

  function invalidateCanvasCache(event) {
    const clearLiveCanvas = Boolean(event?.detail?.clearLiveCanvas);

    if (renderNotificationTimer) {
      clearTimeout(renderNotificationTimer);
      renderNotificationTimer = null;
    }
    lastRenderedSnapshot = null;
    if (!clearLiveCanvas) return;

    canvasStates.forEach(function (state) {
      resetCanvasState(state);
    });
  }

  function handleViewportScrolled() {
    viewportScrollGeneration += 1;
    lastRenderedSnapshot = null;
    if (renderNotificationTimer) {
      clearTimeout(renderNotificationTimer);
      renderNotificationTimer = null;
    }
  }

  function serializeMatrix(ctx) {
    if (typeof ctx.getTransform !== "function") {
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

  function isSameFragmentSlot(existingFragment, nextFragment) {
    const existingMatrix = existingFragment.matrix || {};
    const nextMatrix = nextFragment.matrix || {};

    return (
      Math.abs(existingFragment.x - nextFragment.x) <= SAME_POSITION_EPSILON &&
      Math.abs(existingFragment.y - nextFragment.y) <= SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.a || 0) - (nextMatrix.a || 0)) <=
        SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.b || 0) - (nextMatrix.b || 0)) <=
        SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.c || 0) - (nextMatrix.c || 0)) <=
        SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.d || 0) - (nextMatrix.d || 0)) <=
        SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.e || 0) - (nextMatrix.e || 0)) <=
        SAME_POSITION_EPSILON &&
      Math.abs((existingMatrix.f || 0) - (nextMatrix.f || 0)) <=
        SAME_POSITION_EPSILON
    );
  }

  function parseCssPx(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getTilePosition(parent) {
    if (!parent) return null;

    const styleTop = parent.style?.top || "";
    const styleLeft = parent.style?.left || "";
    const position = {
      top: styleTop,
      left: styleLeft,
      topPx: parseCssPx(styleTop),
      leftPx: parseCssPx(styleLeft),
    };

    if (typeof parent.getBoundingClientRect === "function") {
      const rect = parent.getBoundingClientRect();
      position.viewportRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    return position;
  }

  function getParentPositionSignature(parent) {
    if (!parent) return null;

    return {
      top: parent.style?.top || "",
      left: parent.style?.left || "",
      transform: parent.style?.transform || "",
    };
  }

  function buildCanvasResult(canvas, state) {
    if (!state.fragments.length || !canvas.isConnected) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // Google Docs' rotating tile manager recicla tiles actualizando
    // parentElement.style.top (coords del documento, independiente del scroll).
    // Si ese valor cambió desde que se dibujaron los fragments actuales, el
    // tile fue movido pero aún no redibujado — sus fragments son stale y
    // producen markers fantasma.
    const parent = canvas.parentElement;
    const writePos = state.parentPosAtLastWrite;
    const currentPos = getParentPositionSignature(parent);
    if (
      writePos &&
      currentPos &&
      (writePos.top !== currentPos.top ||
        writePos.left !== currentPos.left ||
        writePos.transform !== currentPos.transform)
    ) {
      return null;
    }
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
      tilePosition: getTilePosition(parent),
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
      document.dispatchEvent(
        new CustomEvent("docs-reviewer-canvas-rendered", {
          detail: {
            renderedAt: getNow(),
            canvases: canvasStates.size,
            totalFragments,
          },
        }),
      );
    }, RENDER_NOTIFICATION_DEBOUNCE_MS);
  }

  const origClearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
    // Full-canvas clear signals a new render cycle for this tile.
    if (
      x === 0 &&
      y === 0 &&
      w >= this.canvas.width &&
      h >= this.canvas.height
    ) {
      const state = ensureCanvasState(this.canvas);
      resetCanvasState(state);
    }
    return origClearRect.apply(this, arguments);
  };

  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (
    text,
    x,
    y,
    maxWidth,
  ) {
    if (text && text.trim().length > 0) {
      const canvas = this.canvas;
      const state = ensureCanvasState(canvas);
      const now = getNow();

      // Google Docs frequently redraws the same canvas after edits/reflow
      // without a full clearRect. Treat temporally separated fillText bursts
      // as a fresh snapshot so old positions do not linger indefinitely.
      if (
        state.viewportScrollGenerationAtLastWrite !==
          viewportScrollGeneration ||
        now - state.lastWriteAt > RENDER_BURST_GAP_MS
      ) {
        resetCanvasState(state);
      }
      state.lastWriteAt = now;
      state.viewportScrollGenerationAtLastWrite = viewportScrollGeneration;
      const parent = canvas.parentElement;
      state.parentPosAtLastWrite = getParentPositionSignature(parent);
      const matrix = serializeMatrix(this);
      const fragment = {
        text,
        x,
        y,
        font: this.font,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        direction: this.direction,
        matrix,
      };
      // Si ya hay un fragment en la misma posición (mismo slot de glyph),
      // el nuevo lo reemplaza: un redibujado del mismo lugar con texto
      // distinto (p.ej. tras una edición) no debe acumular stale.
      const existingIndex = state.fragments.findIndex(function (f) {
        return isSameFragmentSlot(f, fragment);
      });
      if (existingIndex >= 0) {
        state.fragments[existingIndex] = fragment;
      } else {
        state.fragments.push(fragment);
      }
      scheduleRenderNotification();
    }
    return origFillText.apply(this, arguments);
  };

  document.addEventListener(
    "docs-reviewer-invalidate-canvas-cache",
    invalidateCanvasCache,
  );
  document.addEventListener(
    "docs-reviewer-viewport-scrolled",
    handleViewportScrolled,
  );

  // Respond to content script fragment requests with serialized, viewport-resolved data.
  document.addEventListener(
    "docs-reviewer-request-fragments",
    function (event) {
      const allowSnapshotFallback =
        event?.detail?.allowSnapshotFallback !== false;
      const result = [];
      canvasStates.forEach(function (state, canvas) {
        const r = buildCanvasResult(canvas, state);
        if (r) result.push(r);
      });
      let source = "live";

      // If no connected canvas tiles have data (GDocs may have recycled them),
      // fall back to the last rendered snapshot captured when tiles were still connected.
      if (
        result.length === 0 &&
        allowSnapshotFallback &&
        lastRenderedSnapshot
      ) {
        result.push.apply(result, lastRenderedSnapshot.canvasResults);
        source = "snapshot";
      } else if (result.length === 0) {
        source = "empty";
      }

      if (
        typeof window !== "undefined" &&
        typeof window.postMessage === "function"
      ) {
        window.postMessage(
          {
            source: "docs-reviewer-canvas-interceptors",
            type: "docs-reviewer-fragments-data",
            detail: {
              canvasResults: result,
              source,
            },
          },
          "*",
        );
      }
      document.dispatchEvent(
        new CustomEvent("docs-reviewer-fragments-data", {
          detail: {
            canvasResults: result,
            source,
          },
        }),
      );
    },
  );
})();
