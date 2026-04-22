const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

function loadHighlighter(options = {}) {
  const measureContext = {
    font: "16px sans-serif",
    measureText(text) {
      if (typeof options.measureText === "function") {
        return options.measureText(text);
      }
      const width = String(text || "").length;
      return {
        width,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
      };
    },
  };
  function createMockElement(tagName) {
    const style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    return {
      tagName: String(tagName).toUpperCase(),
      style,
      className: "",
      children: [],
      appendChild(node) {
        this.children.push(node);
        node.parentNode = this;
        return node;
      },
      setAttribute(name, value) {
        if (!this.attributes) {
          this.attributes = {};
        }
        this.attributes[name] = String(value);
      },
      addEventListener() {},
      removeEventListener() {},
      remove() {
        this.removed = true;
      },
      classList: {
        toggle() {},
      },
    };
  }
  const windowListeners = new Map();
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    setTimeout(callback, delay, ...args) {
      if (typeof options.setTimeout === "function") {
        return options.setTimeout(callback, delay, ...args);
      }
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(timerId) {
      if (typeof options.clearTimeout === "function") {
        return options.clearTimeout(timerId);
      }
      return clearTimeout(timerId);
    },
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set());
      }
      windowListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      windowListeners.get(type)?.delete(handler);
    },
    getComputedStyle(element) {
      if (typeof options.getComputedStyle === "function") {
        return options.getComputedStyle(element);
      }
      return {
        display: "block",
        visibility: "visible",
        opacity: "1",
        position: "static",
      };
    },
  };
  const body = {
    style: {},
    appendChild(node) {
      node.parentNode = this;
      return node;
    },
  };
  const sandbox = {
    console,
    Map,
    Set,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    chrome: {
      runtime: {
        getURL(pathname) {
          return `chrome-extension://test/${pathname}`;
        },
      },
    },
    document: {
      body,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent(event) {
        if (typeof options.dispatchEvent === "function") {
          return options.dispatchEvent(event);
        }
        return true;
      },
      createElement(tagName) {
        if (tagName === "canvas") {
          return {
            getContext() {
              return measureContext;
            },
          };
        }
        if (typeof options.createElement === "function") {
          return options.createElement(tagName);
        }
        return createMockElement(tagName);
      },
      querySelector(selector) {
        if (typeof options.querySelector === "function") {
          return options.querySelector(selector);
        }
        return null;
      },
    },
    window,
  };

  const { exports } = loadBrowserModule({
    projectRoot,
    sandbox,
    filename: "tests/highlighter-entry.js",
    source: `
      import "./scripts/jsx-runtime.js";
      export { DocsHighlighter } from "./content/highlighter.jsx";
      export { establecerAccionesReviewer } from "./content/reviewer-actions.js";
    `,
  });

  exports.DocsHighlighter.establecerAccionesReviewer =
    exports.establecerAccionesReviewer;
  return exports.DocsHighlighter;
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();

  return {
    setTimeout(callback, delay = 0, ...args) {
      const timerId = nextId++;
      timers.set(timerId, {
        callback: () => callback(...args),
        delay,
      });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    pending() {
      return Array.from(timers.entries()).map(([id, timer]) => ({
        id,
        delay: timer.delay,
      }));
    },
    run(timerId) {
      const timer = timers.get(timerId);
      if (!timer) return false;
      timers.delete(timerId);
      timer.callback();
      return true;
    },
  };
}

function findAllOccurrences(text, needle) {
  if (!text || !needle || needle.length > text.length) return [];

  const starts = [];
  const limit = text.length - needle.length;
  for (let start = 0; start <= limit; start += 1) {
    if (text.startsWith(needle, start)) {
      starts.push(start);
    }
  }
  return starts;
}

function crearCanvasDataTexto(text, { top = 0, left = 0, y = 20 } = {}) {
  return {
    canvasRect: { left, top, width: 500, height: 80 },
    canvasSize: { width: 500, height: 80 },
    tilePosition: {
      top: `${top}px`,
      left: `${left}px`,
      topPx: top,
      leftPx: left,
    },
    fragments: [
      {
        text,
        x: 0,
        y,
        font: "16px sans-serif",
        textAlign: "left",
        textBaseline: "alphabetic",
        direction: "ltr",
        matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ],
  };
}

test("programarReanalisis usa el texto local para refrescar tras editar", () => {
  const timers = createFakeTimers();
  const highlighter = loadHighlighter({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const calls = [];

  highlighter.establecerAccionesReviewer({
    analizarDocumento(options = {}) {
      calls.push(options);
    },
  });

  highlighter.programarReanalisis();

  const pendingTimers = timers.pending();
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 400);

  timers.run(pendingTimers[0].id);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].preservarPanel, true);
  assert.equal(calls[0].silencioso, true);
  assert.equal(calls[0].invalidarCacheCanvas, true);
});

test("asegurarListenersIframe adjunta listeners de edición al iframe de Docs", () => {
  const iframeListeners = new Map();
  const iframeDocument = {
    addEventListener(type, handler) {
      if (!iframeListeners.has(type)) {
        iframeListeners.set(type, []);
      }
      iframeListeners.get(type).push(handler);
    },
  };
  const highlighter = loadHighlighter({
    querySelector(selector) {
      if (selector === "iframe.docs-texteventtarget-iframe") {
        return { contentDocument: iframeDocument };
      }
      return null;
    },
  });
  const calls = [];

  highlighter.programarReanalisis = () => {
    calls.push("reanalyze");
  };

  assert.equal(highlighter.asegurarListenersIframe(), true);
  assert.equal(iframeListeners.has("beforeinput"), true);
  assert.equal(iframeListeners.has("input"), true);
  assert.equal(iframeListeners.has("paste"), true);
  assert.equal(iframeListeners.has("cut"), true);
  assert.equal(iframeListeners.has("compositionend"), true);
  assert.equal(iframeListeners.has("keydown"), true);

  iframeListeners.get("beforeinput")[0]({ target: {} });
  iframeListeners.get("input")[0]({ target: {} });
  iframeListeners
    .get("keydown")
    .forEach((handler) => handler({ key: "a", target: {} }));
  iframeListeners
    .get("keydown")
    .forEach((handler) => handler({ key: "ArrowLeft", target: {} }));

  assert.deepEqual(calls, ["reanalyze", "reanalyze", "reanalyze"]);
});

test("aplicarResaltados limpia el estado y agenda un recálculo por defecto", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderizarMarcadores = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.programarRecalculo = () => {
    calls.push("schedule");
  };

  await highlighter.aplicarResaltados([{ id: "arcaismos-0" }]);

  assert.deepEqual(calls, ["init", "render:0", "schedule"]);
});

test("aplicarResaltados usa un recálculo inicial estabilizado", async () => {
  const highlighter = loadHighlighter();
  let scheduledReason = null;

  highlighter.inicializar = () => {};
  highlighter.renderizarMarcadores = (issueRects) => {
    highlighter.currentRects = issueRects;
  };
  highlighter.programarRecalculo = (reason) => {
    scheduledReason = reason;
  };

  await highlighter.aplicarResaltados([{ id: "arcaismos-0" }]);

  assert.equal(scheduledReason, "initial-load");
});

test("aplicarResaltados preserva markers visibles durante reanálisis en segundo plano", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderizarMarcadores = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.programarRecalculo = () => {
    calls.push("schedule");
  };

  await highlighter.aplicarResaltados([{ id: "arcaismos-0" }], {
    preservarEstadoVisible: true,
  });

  assert.deepEqual(calls, ["init", "schedule"]);
});

test("limpiar preserva el cache de canvas si se pide explícitamente", () => {
  const highlighter = loadHighlighter();

  highlighter._lastRenderedCanvasData = [{ fragments: [{ text: "texto" }] }];
  highlighter._lastRenderedCanvasAt = 1234;
  highlighter.issueMarkers = new Map();

  highlighter.limpiar({ preservarCacheCanvas: true });

  assert.deepEqual(highlighter._lastRenderedCanvasData, [
    { fragments: [{ text: "texto" }] },
  ]);
  assert.equal(highlighter._lastRenderedCanvasAt, 1234);
});

test("limpiar preserva markers y rects si se pide explícitamente", () => {
  const highlighter = loadHighlighter();
  const removed = [];
  const marker = {
    remove() {
      removed.push("marker");
    },
  };

  highlighter.currentRects = new Map([["arcaismos-0", [{ left: 1 }]]]);
  highlighter.issueMarkers = new Map([["arcaismos-0", [marker]]]);
  highlighter.ocultarPopup = () => {
    removed.push("popup");
  };

  highlighter.limpiar({ preservarMarcadores: true });

  assert.equal(removed.length, 0);
  assert.equal(highlighter.currentRects.size, 1);
  assert.equal(highlighter.issueMarkers.size, 1);
});

test("limpiar borra el cache de canvas por defecto", () => {
  const highlighter = loadHighlighter();

  highlighter._lastRenderedCanvasData = [{ fragments: [{ text: "texto" }] }];
  highlighter._lastRenderedCanvasAt = 1234;
  highlighter.issueMarkers = new Map();

  highlighter.limpiar();

  assert.equal(highlighter._lastRenderedCanvasData, null);
  assert.equal(highlighter._lastRenderedCanvasAt, 0);
});

test("invalidarCacheCanvas borra snapshots locales y no pide limpiar canvas live por defecto", () => {
  const dispatchedEvents = [];
  const highlighter = loadHighlighter({
    dispatchEvent(event) {
      dispatchedEvents.push({
        type: event.type,
        detail: event.detail,
      });
      return true;
    },
  });

  highlighter._lastRenderedCanvasData = [{ fragments: [{ text: "stale" }] }];
  highlighter._lastRenderedCanvasAt = 1234;
  highlighter.currentCanvasModels = [{ docStart: 10, docEnd: 20 }];
  highlighter.currentDocumentViewport = { minDocStart: 10, maxDocEnd: 20 };
  highlighter._normalizedSourceCache = { sourceText: "stale" };

  highlighter.invalidarCacheCanvas();
  highlighter.invalidarCacheCanvas();

  assert.equal(highlighter._lastRenderedCanvasData, null);
  assert.equal(highlighter._lastRenderedCanvasAt, 0);
  assert.equal(highlighter.currentCanvasModels.length, 0);
  assert.equal(highlighter.currentDocumentViewport, null);
  assert.equal(highlighter._normalizedSourceCache, null);
  assert.equal(highlighter._awaitingFreshCanvasAfterEdit, true);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(
    dispatchedEvents[0].type,
    "docs-reviewer-invalidate-canvas-cache",
  );
  assert.equal(dispatchedEvents[0].detail?.clearLiveCanvas, false);
});

test("invalidarCacheCanvas permite pedir limpieza explícita de canvas live", () => {
  const dispatchedEvents = [];
  const highlighter = loadHighlighter({
    dispatchEvent(event) {
      dispatchedEvents.push({
        type: event.type,
        detail: event.detail,
      });
      return true;
    },
  });

  highlighter._awaitingFreshCanvasAfterEdit = true;

  highlighter.invalidarCacheCanvas({ clearLiveCanvas: true });

  assert.equal(dispatchedEvents.length, 1);
  assert.equal(
    dispatchedEvents[0].type,
    "docs-reviewer-invalidate-canvas-cache",
  );
  assert.equal(dispatchedEvents[0].detail?.clearLiveCanvas, true);
});

test("guardarDatosCanvasRenderizado no termina la espera post-edición", () => {
  const highlighter = loadHighlighter();
  const canvasResults = [{ fragments: [{ text: "parcial" }] }];

  highlighter._awaitingFreshCanvasAfterEdit = true;

  const saved = highlighter.guardarDatosCanvasRenderizado(canvasResults);

  assert.equal(saved, true);
  assert.equal(highlighter._lastRenderedCanvasData, canvasResults);
  assert.equal(highlighter._awaitingFreshCanvasAfterEdit, true);
});

test("registrarScrollViewportCanvas avisa al interceptor e invalida scroll reciente", () => {
  const dispatched = [];
  const highlighter = loadHighlighter({
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
  });

  highlighter.registrarScrollViewportCanvas();

  assert.equal(dispatched.includes("docs-reviewer-viewport-scrolled"), true);
  assert.equal(highlighter.huboScrollViewportReciente(), true);
});

test("recalcularPosiciones conserva markers mientras espera canvas fresco tras editar", async () => {
  const highlighter = loadHighlighter();
  let rendered = false;

  highlighter.overlayElement = {};
  highlighter.issues = [{ id: "arcaismos-0" }];
  highlighter.currentRects = new Map([["arcaismos-0", [{ left: 10 }]]]);
  highlighter._awaitingFreshCanvasAfterEdit = true;
  highlighter.solicitarFragmentosCanvas = async () => ({
    canvasResults: [],
    source: "empty",
  });
  highlighter.renderizarMarcadores = () => {
    rendered = true;
  };

  await highlighter.recalcularPosiciones("general");

  assert.equal(rendered, false);
  assert.equal(highlighter.currentRects.size, 1);
});

test("recalcularPosiciones no usa snapshot ni cache tras canvas-rendered de scroll", async () => {
  const highlighter = loadHighlighter();
  let requestOptions = null;
  let renderedRects = null;

  highlighter.overlayElement = {};
  highlighter.issues = [{ id: "issue-previo" }];
  highlighter._lastViewportScrollAt = Date.now();
  highlighter._lastRenderedCanvasData = [{ fragments: [{ text: "stale" }] }];
  highlighter._lastRenderedCanvasAt = Date.now();
  highlighter.solicitarFragmentosCanvas = async (options = {}) => {
    requestOptions = options;
    return {
      canvasResults: [],
      source: "empty",
    };
  };
  highlighter.renderizarMarcadores = (issueRects) => {
    renderedRects = issueRects;
  };

  await highlighter.recalcularPosiciones("canvas-rendered");

  assert.equal(requestOptions.allowSnapshotFallback, false);
  assert.equal(renderedRects.size, 0);
});

test("recalcularPosiciones espera render estable en carga inicial", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.overlayElement = {};
  highlighter.issues = [{ id: "arcaismos-0" }];
  highlighter.esperarRenderCanvasEstable = async () => {
    calls.push("wait-render");
  };
  highlighter.solicitarFragmentosCanvas = async () => {
    calls.push("request-fragments");
    return {
      canvasResults: [],
      source: "empty",
    };
  };
  highlighter.renderizarMarcadores = () => {
    calls.push("render");
  };

  await highlighter.recalcularPosiciones("initial-load");

  assert.deepEqual(calls, ["wait-render", "request-fragments", "render"]);
});

test("recalcularPosiciones preserva rects previos faltantes durante repaint parcial", async () => {
  const highlighter = loadHighlighter();
  const previousRect = {
    left: 10,
    top: 10,
    right: 40,
    bottom: 22,
    width: 30,
    height: 12,
  };
  const currentRect = {
    left: 20,
    top: 40,
    right: 50,
    bottom: 52,
    width: 30,
    height: 12,
  };
  let renderedRects = null;

  highlighter.overlayElement = {};
  highlighter.issues = [
    { id: "issue-previo" },
    { id: "issue-actual" },
  ];
  highlighter.currentRects = new Map([["issue-previo", [previousRect]]]);
  highlighter._awaitingFreshCanvasAfterEdit = true;
  highlighter.solicitarFragmentosCanvas = async () => ({
    canvasResults: [{ fragments: [{ text: "actual" }] }],
    source: "live",
  });
  highlighter.construirModelosTextoPorCanvas = () => [];
  highlighter.mapearIssuesARectangulosDesdeCanvas = () =>
    new Map([
      ["issue-previo", []],
      ["issue-actual", [currentRect]],
    ]);
  highlighter.obtenerVentanaDocumentoVisibleDesdeCanvasModels = () => ({
    minDocStart: 10,
    maxDocEnd: 20,
  });
  highlighter.renderizarMarcadores = (issueRects) => {
    renderedRects = issueRects;
  };

  await highlighter.recalcularPosiciones("general");

  assert.equal(renderedRects.get("issue-previo")[0], previousRect);
  assert.equal(renderedRects.get("issue-actual")[0], currentRect);
  assert.equal(highlighter._awaitingFreshCanvasAfterEdit, true);
});

test("conservarRectangulosPreviosFaltantes preserva rects si cambia el id del issue", () => {
  const highlighter = loadHighlighter();
  const previousRect = {
    left: 10,
    top: 10,
    right: 40,
    bottom: 22,
    width: 30,
    height: 12,
  };
  const previousIssue = {
    id: "arcaismos-previo",
    regla: "arcaismos",
    textoOriginal: "susodicho",
    issueIdentityKey: "arcaismos|susodicho|clave|final",
    issueIdBase: "arcaismos-abc",
  };
  const nextIssue = {
    id: "arcaismos-nuevo",
    regla: "arcaismos",
    textoOriginal: "susodicho",
    issueIdentityKey: previousIssue.issueIdentityKey,
    issueIdBase: previousIssue.issueIdBase,
  };

  highlighter.issues = [previousIssue];
  highlighter.currentRects = new Map([[previousIssue.id, [previousRect]]]);
  highlighter._previousVisibleIssueSnapshots =
    highlighter.capturarIssuesVisiblesPrevios();
  highlighter.issues = [nextIssue];
  highlighter.currentRects = new Map([[previousIssue.id, [previousRect]]]);

  const { issueRects, preservedCount } =
    highlighter.conservarRectangulosPreviosFaltantes(
      new Map([[nextIssue.id, []]]),
    );

  assert.equal(preservedCount, 1);
  assert.equal(issueRects.get(nextIssue.id)[0], previousRect);
});

test("recalcularPosiciones termina espera post-edición cuando no necesita preservar rects", async () => {
  const highlighter = loadHighlighter();
  const rect = {
    left: 20,
    top: 40,
    right: 50,
    bottom: 52,
    width: 30,
    height: 12,
  };

  highlighter.overlayElement = {};
  highlighter.issues = [{ id: "issue-actual" }];
  highlighter.currentRects = new Map();
  highlighter._awaitingFreshCanvasAfterEdit = true;
  highlighter.solicitarFragmentosCanvas = async () => ({
    canvasResults: [{ fragments: [{ text: "actual" }] }],
    source: "live",
  });
  highlighter.construirModelosTextoPorCanvas = () => [];
  highlighter.mapearIssuesARectangulosDesdeCanvas = () =>
    new Map([["issue-actual", [rect]]]);
  highlighter.obtenerVentanaDocumentoVisibleDesdeCanvasModels = () => null;
  highlighter.renderizarMarcadores = () => {};

  await highlighter.recalcularPosiciones("general");

  assert.equal(highlighter._awaitingFreshCanvasAfterEdit, false);
});

test("recalcularPosiciones no preserva rects previos durante scroll", async () => {
  const highlighter = loadHighlighter();
  const previousRect = {
    left: 10,
    top: 10,
    right: 40,
    bottom: 22,
    width: 30,
    height: 12,
  };
  let renderedRects = null;

  highlighter.overlayElement = {};
  highlighter.issues = [{ id: "issue-previo" }];
  highlighter.currentRects = new Map([["issue-previo", [previousRect]]]);
  highlighter._awaitingFreshCanvasAfterEdit = true;
  highlighter.solicitarFragmentosCanvas = async () => ({
    canvasResults: [{ fragments: [{ text: "otro viewport" }] }],
    source: "live",
  });
  highlighter.construirModelosTextoPorCanvas = () => [];
  highlighter.mapearIssuesARectangulosDesdeCanvas = () =>
    new Map([["issue-previo", []]]);
  highlighter.obtenerVentanaDocumentoVisibleDesdeCanvasModels = () => null;
  highlighter.renderizarMarcadores = (issueRects) => {
    renderedRects = issueRects;
  };

  await highlighter.recalcularPosiciones("scroll");

  assert.equal(renderedRects.get("issue-previo").length, 0);
  assert.equal(highlighter._awaitingFreshCanvasAfterEdit, false);
});

test("desplazarRectanguloAVistaSiNecesario alinea el issue a 50px del top", () => {
  const highlighter = loadHighlighter();
  const scrolls = [];
  const container = {
    clientHeight: 500,
    getBoundingClientRect() {
      return { top: 0, height: 500 };
    },
    scrollBy(options) {
      scrolls.push(options);
    },
  };

  highlighter.obtenerContenedorDesplazamiento = () => container;
  highlighter.desplazarRectanguloAVistaSiNecesario({
    top: 200,
    bottom: 220,
  });

  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].top, 150);
  assert.equal(scrolls[0].behavior, "smooth");
});

test("convertirViewportAHost traduce coordenadas al host del editor", () => {
  const host = {
    style: {},
    appendChild(node) {
      node.parentNode = this;
      return node;
    },
    getBoundingClientRect() {
      return {
        left: 40,
        top: 120,
        right: 940,
        bottom: 720,
        width: 900,
        height: 600,
      };
    },
  };
  const highlighter = loadHighlighter({
    querySelector(selector) {
      if (selector === ".kix-appview-editor-container") {
        return host;
      }
      return null;
    },
  });

  highlighter.overlayElement = { style: {} };
  highlighter.popupElement = { style: {} };

  const point = highlighter.convertirViewportAHost(150, 260);

  assert.equal(point.left, 110);
  assert.equal(point.top, 140);
  assert.equal(highlighter.overlayHostElement, host);
  assert.equal(highlighter.overlayElement.style.position, "absolute");
  assert.equal(highlighter.popupElement.style.position, "absolute");
  assert.equal(host.style.position, "relative");
});

test("posicionarPopup acerca la esquina superior izquierda al puntero cuando hay ancla", () => {
  const highlighter = loadHighlighter();

  highlighter.popupElement = {
    style: {},
    getBoundingClientRect() {
      return {
        width: 240,
        height: 120,
      };
    },
  };
  highlighter.obtenerRectHostOverlay = () => ({ left: 0, top: 0 });
  highlighter.convertirViewportAHost = (left, top) => ({ left, top });
  highlighter.popupAnchor = {
    issueId: "rodeos-0",
    clientX: 100,
    clientY: 200,
    rectIndex: 0,
  };

  highlighter.posicionarPopup(
    { left: 40, top: 180, bottom: 230, width: 80, height: 50 },
    "rodeos-0",
  );

  assert.equal(highlighter.popupElement.style.left, "70px");
  assert.equal(highlighter.popupElement.style.top, "208px");
});

test("sincronizarIssuesConRectangulos deja visible un issue recuperado por fallback", () => {
  const highlighter = loadHighlighter();

  highlighter.issues = [
    { id: "arcaismos-0", rects: [], isVisible: false },
    { id: "voz-pasiva-0", rects: [], isVisible: false },
  ];

  highlighter.sincronizarIssuesConRectangulos(
    new Map([
      ["arcaismos-0", [{ left: 10, top: 10, right: 30, bottom: 20, width: 20, height: 10 }]],
      ["voz-pasiva-0", [{ left: 40, top: 10, right: 100, bottom: 20, width: 60, height: 10 }]],
    ]),
  );

  assert.equal(highlighter.issues[0].isVisible, true);
  assert.equal(highlighter.issues[1].isVisible, true);
  assert.equal(highlighter.issues[1].rects.length, 1);
});

test("renderizarMarcadores ancla los markers a una banda fija bajo cada renglón", () => {
  const overlayChildren = [];
  const highlighter = loadHighlighter({
    querySelector(selector) {
      if (selector !== ".kix-appview-editor") return null;
      return {
        getBoundingClientRect() {
          return {
            top: 40,
          };
        },
      };
    },
  });

  highlighter.establecerAccionesReviewer({
    obtenerIssue(issueId) {
      return {
        id: issueId,
        regla: "rodeos",
      };
    },
  });
  highlighter.overlayElement = {
    style: {},
    appendChild(node) {
      overlayChildren.push(node);
      node.parentNode = this;
      return node;
    },
  };
  highlighter.obtenerRectHostOverlay = () => ({ left: 0, top: 0 });
  highlighter.convertirViewportAHost = (left, top) => ({ left, top });
  highlighter.sincronizarIssuesConRectangulos = () => {};
  highlighter.reposicionarDestelloFoco = () => {};
  highlighter.actualizarClasesMarcadores = () => {};
  highlighter.ocultarPopup = () => {};
  highlighter.issueMarkers = new Map();

  highlighter.renderizarMarcadores(
    new Map([
      [
        "rodeos-0",
        [
          { left: 10, top: 50, bottom: 64, width: 40, height: 14 },
          { left: 10, top: 78, bottom: 92, width: 70, height: 14 },
        ],
      ],
    ]),
  );

  const markers = highlighter.issueMarkers.get("rodeos-0");
  assert.equal(markers.length, 2);
  assert.equal(overlayChildren.length, 2);
  assert.equal(markers[0].style.top, "64px");
  assert.equal(markers[0].style.height, "6px");
  assert.equal(markers[1].style.top, "92px");
  assert.equal(markers[1].style.height, "6px");
});

test("renderizarMarcadores usa el ancla de subrayado si el rect la trae", () => {
  const overlayChildren = [];
  const highlighter = loadHighlighter({
    querySelector(selector) {
      if (selector !== ".kix-appview-editor") return null;
      return {
        getBoundingClientRect() {
          return {
            top: 40,
          };
        },
      };
    },
  });

  highlighter.establecerAccionesReviewer({
    obtenerIssue(issueId) {
      return {
        id: issueId,
        regla: "rodeos",
      };
    },
  });
  highlighter.overlayElement = {
    style: {},
    appendChild(node) {
      overlayChildren.push(node);
      node.parentNode = this;
      return node;
    },
  };
  highlighter.obtenerRectHostOverlay = () => ({ left: 0, top: 0 });
  highlighter.convertirViewportAHost = (left, top) => ({ left, top });
  highlighter.sincronizarIssuesConRectangulos = () => {};
  highlighter.reposicionarDestelloFoco = () => {};
  highlighter.actualizarClasesMarcadores = () => {};
  highlighter.ocultarPopup = () => {};
  highlighter.issueMarkers = new Map();

  highlighter.renderizarMarcadores(
    new Map([
      [
        "rodeos-0",
        [
          {
            left: 10,
            top: 50,
            bottom: 62,
            width: 40,
            height: 12,
            underlineTop: 65,
          },
          {
            left: 80,
            top: 50,
            bottom: 68,
            width: 40,
            height: 18,
            underlineTop: 65,
          },
        ],
      ],
    ]),
  );

  const markers = highlighter.issueMarkers.get("rodeos-0");
  assert.equal(markers.length, 2);
  assert.equal(overlayChildren.length, 2);
  assert.equal(markers[0].style.top, "65px");
  assert.equal(markers[1].style.top, "65px");
});

test("obtenerIssueHoverEnCoordenadas detecta hover sobre la palabra y cerca del subrayado", () => {
  const highlighter = loadHighlighter();
  highlighter.currentRects = new Map([
    [
      "rodeos-0",
      [
        {
          left: 10,
          right: 60,
          top: 50,
          bottom: 64,
          width: 50,
          height: 14,
        },
      ],
    ],
  ]);

  assert.equal(highlighter.obtenerIssueHoverEnCoordenadas(20, 55), "rodeos-0");
  assert.equal(highlighter.obtenerIssueHoverEnCoordenadas(20, 70), "rodeos-0");
  assert.equal(highlighter.obtenerIssueHoverEnCoordenadas(20, 73), null);
});

test("manejarEntradaHoverIssue espera 200 ms antes de mostrar el popup", () => {
  const timers = createFakeTimers();
  const actions = [];
  const highlighter = loadHighlighter({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  highlighter.cancelarOcultacionPopup = () => {};
  highlighter.establecerAccionesReviewer({
    establecerIssueActivo(issueId, options = {}) {
      actions.push({ issueId, options });
    },
  });

  highlighter.manejarEntradaHoverIssue("rodeos-0");

  assert.equal(highlighter.hoverIssueId, "rodeos-0");
  assert.equal(highlighter.hoverPopupIssueId, null);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].issueId, "rodeos-0");
  assert.equal(actions[0].options.mostrarPopup, false);

  const pendingTimers = timers.pending();
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 200);

  timers.run(pendingTimers[0].id);

  assert.equal(highlighter.hoverPopupIssueId, "rodeos-0");
  assert.equal(actions.length, 2);
  assert.equal(actions[1].issueId, "rodeos-0");
  assert.equal(actions[1].options.mostrarPopup, true);
});

test("manejarSalidaHoverIssue cancela el popup si el cursor pasa rápido", () => {
  const timers = createFakeTimers();
  const actions = [];
  const highlighter = loadHighlighter({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  highlighter.cancelarOcultacionPopup = () => {};
  highlighter.intentarOcultarPopup = () => {
    actions.push({ hideRequested: true });
  };
  highlighter.establecerAccionesReviewer({
    establecerIssueActivo(issueId, options = {}) {
      actions.push({ issueId, options });
    },
  });

  highlighter.manejarEntradaHoverIssue("rodeos-0");
  const [showTimer] = timers.pending();

  highlighter.manejarSalidaHoverIssue("rodeos-0", null);

  assert.equal(highlighter.hoverIssueId, null);
  assert.equal(highlighter.hoverPopupIssueId, null);
  assert.equal(timers.pending().length, 0);
  assert.equal(timers.run(showTimer.id), false);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].issueId, "rodeos-0");
  assert.equal(actions[0].options.mostrarPopup, false);
  assert.equal(actions[1].hideRequested, true);
});

test("intentarOcultarPopup espera 700 ms antes de limpiar el issue activo", () => {
  const timers = createFakeTimers();
  const actions = [];
  const highlighter = loadHighlighter({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  highlighter.establecerAccionesReviewer({
    limpiarIssueActivo(options = {}) {
      actions.push(options);
    },
  });

  highlighter.intentarOcultarPopup(null);

  const pendingTimers = timers.pending();
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 300);
  assert.equal(actions.length, 0);

  timers.run(pendingTimers[0].id);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].preservarPopupFijado, false);
});

test("manejarTeclaDocumento cierra el popup con Escape", () => {
  const actions = [];
  const highlighter = loadHighlighter();

  highlighter.pinnedIssueId = "rodeos-0";
  highlighter.limpiarAnclaPopup = () => {
    actions.push({ clearAnchor: true });
  };
  highlighter.establecerAccionesReviewer({
    limpiarIssueActivo() {
      actions.push({ clearIssue: true });
    },
  });

  highlighter.manejarTeclaDocumento({ key: "Escape" });

  assert.equal(highlighter.pinnedIssueId, null);
  assert.deepEqual(actions, [{ clearAnchor: true }, { clearIssue: true }]);
});

test("manejarMovimientoPuntero no activa otro issue mientras un popup visible sigue abierto", () => {
  const highlighter = loadHighlighter();
  const exits = [];
  const entries = [];

  highlighter.currentRects = new Map([
    [
      "rodeos-0",
      [
        {
          left: 10,
          right: 90,
          top: 40,
          bottom: 54,
          width: 80,
          height: 14,
        },
      ],
    ],
    [
      "tecnicismos-0",
      [
        {
          left: 100,
          right: 180,
          top: 40,
          bottom: 54,
          width: 80,
          height: 14,
        },
      ],
    ],
  ]);
  highlighter.visiblePopupIssueId = "rodeos-0";
  highlighter.hoverIssueId = "rodeos-0";
  highlighter.manejarSalidaHoverIssue = (issueId) => {
    exits.push(issueId);
    highlighter.hoverIssueId = null;
  };
  highlighter.manejarEntradaHoverIssue = (issueId) => {
    entries.push(issueId);
  };

  highlighter.manejarMovimientoPuntero({
    clientX: 120,
    clientY: 45,
    target: {},
  });

  assert.deepEqual(exits, ["rodeos-0"]);
  assert.deepEqual(entries, []);
});

test("manejarEntradaHoverIssue preserva el popup visible del mismo issue", () => {
  const highlighter = loadHighlighter();
  const actions = [];

  highlighter.cancelarOcultacionPopup = () => {};
  highlighter.programarMostrarPopupHover = () => {
    actions.push("scheduled");
  };
  highlighter.establecerAccionesReviewer({
    establecerIssueActivo(issueId, options = {}) {
      actions.push({ issueId, options });
    },
  });
  highlighter.visiblePopupIssueId = "rodeos-0";
  highlighter.hoverPopupIssueId = null;

  highlighter.manejarEntradaHoverIssue("rodeos-0", {
    clientX: 20,
    clientY: 50,
  });

  assert.equal(highlighter.hoverIssueId, "rodeos-0");
  assert.equal(highlighter.hoverPopupIssueId, "rodeos-0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].issueId, "rodeos-0");
  assert.equal(actions[0].options.mostrarPopup, true);
});

test("obtenerRectTriggerPopup usa el rect del renglón donde está el puntero", () => {
  const highlighter = loadHighlighter();
  const firstRect = {
    left: 10,
    right: 90,
    top: 40,
    bottom: 54,
    width: 80,
    height: 14,
  };
  const secondRect = {
    left: 10,
    right: 130,
    top: 72,
    bottom: 86,
    width: 120,
    height: 14,
  };

  highlighter.popupAnchor = {
    issueId: "rodeos-0",
    clientX: 40,
    clientY: 78,
  };

  assert.equal(
    highlighter.obtenerRectTriggerPopup("rodeos-0", [firstRect, secondRect]),
    secondRect,
  );
});

test("manejarMovimientoPuntero no reposiciona ni cambia el ancla si el popup ya está visible", () => {
  const highlighter = loadHighlighter();
  const repositioned = [];

  highlighter.currentRects = new Map([
    [
      "rodeos-0",
      [
        {
          left: 10,
          right: 90,
          top: 40,
          bottom: 54,
          width: 80,
          height: 14,
        },
        {
          left: 10,
          right: 130,
          top: 72,
          bottom: 86,
          width: 120,
          height: 14,
        },
      ],
    ],
  ]);
  highlighter.hoverIssueId = "rodeos-0";
  highlighter.hoverPopupIssueId = "rodeos-0";
  highlighter.popupAnchor = {
    issueId: "rodeos-0",
    clientX: 30,
    clientY: 50,
    rectIndex: 0,
  };
  highlighter.reposicionarPopupParaIssue = (issueId) => {
    repositioned.push(issueId);
  };

  highlighter.manejarMovimientoPuntero({
    clientX: 40,
    clientY: 78,
    target: {},
  });

  assert.deepEqual(repositioned, []);
  assert.equal(highlighter.popupAnchor.issueId, "rodeos-0");
  assert.equal(highlighter.popupAnchor.clientX, 30);
  assert.equal(highlighter.popupAnchor.clientY, 50);
  assert.equal(highlighter.popupAnchor.rectIndex, 0);
});

test("adivinarDireccionScroll usa el orden de los issues visibles para decidir la dirección", () => {
  const highlighter = loadHighlighter();

  highlighter.issues = [
    { id: "arcaismos-0", inicio: 10 },
    { id: "arcaismos-1", inicio: 20 },
    { id: "arcaismos-2", inicio: 30 },
    { id: "arcaismos-3", inicio: 40 },
    { id: "arcaismos-4", inicio: 50 },
  ];
  highlighter.currentRects = new Map([
    ["arcaismos-2", [{ left: 1 }]],
    ["arcaismos-3", [{ left: 1 }]],
  ]);

  assert.equal(highlighter.adivinarDireccionScroll(highlighter.issues[0]), -1);
  assert.equal(highlighter.adivinarDireccionScroll(highlighter.issues[4]), 1);
});

test("determinarDireccionScrollHaciaIssue no desplaza si el issue ya cae en el viewport", () => {
  const highlighter = loadHighlighter();

  highlighter.currentDocumentViewport = { minDocStart: 100, maxDocEnd: 200 };

  assert.equal(
    highlighter.determinarDireccionScrollHaciaIssue({ normalizedStart: 99 }),
    -1,
  );
  assert.equal(
    highlighter.determinarDireccionScrollHaciaIssue({ normalizedStart: 150 }),
    0,
  );
  assert.equal(
    highlighter.determinarDireccionScrollHaciaIssue({ normalizedStart: 200 }),
    1,
  );
});

test("enfocarIssueOffscreen intenta un recálculo antes de desplazar el documento", async () => {
  const highlighter = loadHighlighter();
  const rect = {
    left: 10,
    right: 40,
    top: 50,
    bottom: 64,
    width: 30,
    height: 14,
  };
  const calls = [];

  highlighter.issues = [{ id: "arcaismos-0", inicio: 10 }];
  highlighter.currentRects = new Map();
  highlighter.establecerAccionesReviewer({
    obtenerIssue() {
      return { id: "arcaismos-0", inicio: 10 };
    },
  });
  highlighter.recalcularPosiciones = async () => {
    calls.push("recalc");
    highlighter.currentRects = new Map([["arcaismos-0", [rect]]]);
  };
  highlighter.desplazarRectanguloAVistaSiNecesario = () => {
    calls.push("scroll-into-view");
  };
  highlighter.establecerIssueActivo = () => {
    calls.push("set-active");
  };
  highlighter.mostrarDestelloFoco = () => {
    calls.push("flash");
  };

  const focused = await highlighter.enfocarIssueOffscreen("arcaismos-0");

  assert.equal(focused, true);
  assert.deepEqual(calls.slice(0, 3), [
    "recalc",
    "scroll-into-view",
    "set-active",
  ]);
});

test("enfocarIssueOffscreen fuerza scroll aproximado si el issue esta en viewport sin rects", async () => {
  const highlighter = loadHighlighter();
  const issue = {
    id: "arcaismos-target",
    normalizedStart: 150,
  };
  const rect = {
    left: 10,
    right: 40,
    top: 50,
    bottom: 64,
    width: 30,
    height: 14,
  };
  const container = {
    scrollTop: 0,
    scrollHeight: 3000,
    clientHeight: 400,
  };
  const calls = [];
  let recalcs = 0;

  highlighter.establecerAccionesReviewer({
    obtenerIssue() {
      return issue;
    },
  });
  highlighter.obtenerContenedorDesplazamiento = () => container;
  highlighter.recalcularPosiciones = async () => {
    recalcs += 1;
    highlighter.currentDocumentViewport = { minDocStart: 100, maxDocEnd: 200 };
    highlighter.currentRects =
      recalcs >= 2 ? new Map([[issue.id, [rect]]]) : new Map();
  };
  highlighter.desplazarAproximadamenteAIssue = () => {
    calls.push("approx-scroll");
  };
  highlighter.esperarCanvasRendered = async () => {
    calls.push("wait-canvas");
  };
  highlighter.desplazarRectanguloAVistaSiNecesario = () => {
    calls.push("scroll-into-view");
  };
  highlighter.establecerIssueActivo = () => {
    calls.push("set-active");
  };
  highlighter.mostrarDestelloFoco = () => {
    calls.push("flash");
  };
  highlighter.reposicionarDestelloTrasCroll = () => {};

  const focused = await highlighter.enfocarIssueOffscreen(issue.id);

  assert.equal(focused, true);
  assert.deepEqual(calls.slice(0, 3), [
    "wait-canvas",
    "approx-scroll",
    "scroll-into-view",
  ]);
});

test("enfocarIssueOffscreen salta cerca del issue si queda lejos del viewport actual", async () => {
  const highlighter = loadHighlighter();
  const issue = {
    id: "arcaismos-target",
    inicio: 850,
    normalizedStart: 850,
  };
  const rect = {
    left: 10,
    right: 40,
    top: 50,
    bottom: 64,
    width: 30,
    height: 14,
  };
  const container = {
    scrollTop: 0,
    scrollHeight: 5000,
    clientHeight: 400,
    scrollTo({ top }) {
      this.scrollTop = top;
      calls.push(`scroll-to:${Math.round(top)}`);
    },
  };
  const calls = [];
  const recalcReasons = [];
  let recalcs = 0;

  highlighter.establecerAccionesReviewer({
    sourceText: "x".repeat(1000),
    obtenerIssue() {
      return issue;
    },
  });
  highlighter.obtenerContenedorDesplazamiento = () => container;
  highlighter.esperarCanvasRendered = async () => {
    calls.push("wait-canvas");
  };
  highlighter.recalcularPosiciones = async (reason) => {
    recalcReasons.push(reason);
    recalcs += 1;
    highlighter.currentDocumentViewport =
      recalcs === 1
        ? { minDocStart: 0, maxDocEnd: 100 }
        : { minDocStart: 820, maxDocEnd: 900 };
    highlighter.currentRects =
      recalcs >= 2 ? new Map([[issue.id, [rect]]]) : new Map();
  };
  highlighter.desplazarRectanguloAVistaSiNecesario = () => {
    calls.push("scroll-into-view");
  };
  highlighter.establecerIssueActivo = () => {};
  highlighter.mostrarDestelloFoco = () => {};
  highlighter.reposicionarDestelloTrasCroll = () => {};

  const focused = await highlighter.enfocarIssueOffscreen(issue.id);

  assert.equal(focused, true);
  assert.deepEqual(recalcReasons, ["general", "focus-scroll"]);
  assert.deepEqual(calls.slice(0, 3), [
    "wait-canvas",
    "scroll-to:3910",
    "scroll-into-view",
  ]);
});

test("encontrarMejorRangoTexto encuentra voz pasiva aunque falten separadores exactos", () => {
  const highlighter = loadHighlighter();

  const match = highlighter.encontrarMejorRangoTexto(
    "la sentencia fue dictada por estetribunal en la fecha de ayer",
    "fue dictada por este tribunal",
    10,
  );

  assert.equal(match.start, 13);
  assert.equal(match.end, 41);
});

test("construirModeloTextoCanvas no inserta espacios sintéticos entre fragmentos pegados", () => {
  const highlighter = loadHighlighter();

  const model = highlighter.construirModeloTextoCanvas([
    {
      text: "Trib",
      font: "16px sans-serif",
      textAlign: "left",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "unal",
      font: "16px sans-serif",
      textAlign: "left",
      viewportBaselineX: 4,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ]);

  assert.equal(model.normalizedText, "Tribunal");
});

test("construirModeloTextoCanvas sí inserta espacios entre palabras separadas", () => {
  const highlighter = loadHighlighter();

  const model = highlighter.construirModeloTextoCanvas([
    {
      text: "fue",
      font: "16px sans-serif",
      textAlign: "left",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "dictada",
      font: "16px sans-serif",
      textAlign: "left",
      viewportBaselineX: 6,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ]);

  assert.equal(model.normalizedText, "fue dictada");
});

test("construirFragmentosOrdenados mantiene el orden izquierda-derecha cuando la baseline sigue dentro del mismo renglón", () => {
  const highlighter = loadHighlighter();

  const fragments = highlighter.construirFragmentosOrdenados([
    {
      canvasRect: { left: 0, top: 0, width: 500, height: 500 },
      canvasSize: { width: 500, height: 500 },
      fragments: [
        {
          text: "dictada",
          x: 120,
          y: 21,
          font: "16px sans-serif",
          textAlign: "left",
          textBaseline: "alphabetic",
          direction: "ltr",
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        },
        {
          text: "fue",
          x: 80,
          y: 20,
          font: "16px sans-serif",
          textAlign: "left",
          textBaseline: "alphabetic",
          direction: "ltr",
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        },
        {
          text: "por",
          x: 20,
          y: 48,
          font: "16px sans-serif",
          textAlign: "left",
          textBaseline: "alphabetic",
          direction: "ltr",
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        },
      ],
    },
  ]);

  assert.equal(
    fragments.map((fragment) => fragment.text).join("|"),
    "fue|dictada|por",
  );
});

test("calcularRectanguloPorcionFragmento respeta textBaseline top y no desplaza el rect hacia arriba", () => {
  const highlighter = loadHighlighter();

  const rect = highlighter.calcularRectanguloPorcionFragmento(
    {
      text: "fue dictada",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "top",
      viewportBaselineX: 100,
      viewportBaselineY: 200,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    0,
    3,
  );

  assert.equal(rect.top, 200);
  assert.ok(rect.bottom > rect.top);
});

test("calcularRectanguloPorcionFragmento ancla el subrayado a la baseline", () => {
  const highlighter = loadHighlighter({
    measureText(text) {
      const value = String(text || "");
      return {
        width: value.length,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: value.includes("p") ? 5 : 1,
      };
    },
  });
  const commonFragment = {
    font: "16px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    viewportBaselineX: 100,
    viewportBaselineY: 200,
    viewportScaleX: 1,
    viewportScaleY: 1,
  };

  const rectSinDescendente = highlighter.calcularRectanguloPorcionFragmento(
    {
      ...commonFragment,
      text: "son",
    },
    0,
    3,
  );
  const rectConDescendente = highlighter.calcularRectanguloPorcionFragmento(
    {
      ...commonFragment,
      text: "prestatario",
    },
    0,
    11,
  );

  assert.notEqual(rectSinDescendente.bottom, rectConDescendente.bottom);
  assert.equal(rectSinDescendente.baselineY, 200);
  assert.equal(rectConDescendente.baselineY, 200);
  assert.equal(rectSinDescendente.underlineTop, rectConDescendente.underlineTop);

  const [normalized] = highlighter.normalizarRectangulos([
    rectSinDescendente,
  ]);
  assert.equal(normalized.underlineTop, rectSinDescendente.underlineTop);
});

test("calcularRectangulosDesdeIndicesCanvas devuelve un rect por cada línea al cruzar un wrap", () => {
  const highlighter = loadHighlighter();

  const sortedFragments = [
    {
      text: "fue dictada por este",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 100,
      viewportBaselineY: 200,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "Tribunal",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 100,
      viewportBaselineY: 224,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];

  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);
  const needle = highlighter.normalizarTexto("fue dictada por este Tribunal");
  const match = highlighter.encontrarMejorRangoTexto(
    canvasTextModel.normalizedLower,
    needle,
    0,
  );
  const rects = highlighter.calcularRectangulosDesdeIndicesCanvas(
    sortedFragments,
    canvasTextModel.charMap,
    match.start,
    match.end,
  );

  assert.equal(rects.length, 2);
  assert.ok(rects[1].top > rects[0].top);
});

test("filtrarRectangulosFueraDelEditor conserva un rect parcialmente visible", () => {
  const highlighter = loadHighlighter({
    querySelector(selector) {
      if (selector !== ".kix-appview-editor") return null;
      return {
        getBoundingClientRect() {
          return {
            top: 20,
            bottom: 200,
            width: 400,
            height: 180,
          };
        },
      };
    },
  });

  const filtered = highlighter.filtrarRectangulosFueraDelEditor([
    { left: 70, top: 10, right: 103, bottom: 23, width: 33, height: 13 },
    { left: 0, top: 34, right: 8, bottom: 47, width: 8, height: 13 },
  ]);

  assert.equal(filtered.length, 2);
});

test("mapearIssuesARectangulosDesdeCanvas no cruza issue ids entre duplicados con distinto casing", () => {
  const highlighter = loadHighlighter();
  const sourceText = "resolución judicial firme. RESOLUCIÓN DEL CONTRATO";
  const sortedFragments = [
    {
      text: sourceText,
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);
  const lowerStart = canvasTextModel.normalizedText.indexOf("resolución");
  const upperStart = canvasTextModel.normalizedText.indexOf("RESOLUCIÓN");

  highlighter.logDebug = () => {};
  highlighter.establecerAccionesReviewer({ sourceText });
  highlighter.issues = [
    {
      id: "tecnicismos-0",
      regla: "tecnicismos",
      textoOriginal: "RESOLUCIÓN",
      normalizedStart: lowerStart,
      normalizedEnd: lowerStart + "RESOLUCIÓN".length,
      ordinalExacto: 0,
      ordinalMinusculas: 1,
    },
    {
      id: "tecnicismos-1",
      regla: "tecnicismos",
      textoOriginal: "resolución",
      normalizedStart: upperStart,
      normalizedEnd: upperStart + "resolución".length,
      ordinalExacto: 0,
      ordinalMinusculas: 0,
    },
  ];

  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(
    sortedFragments,
    canvasTextModel,
  );

  assert.equal(rects.get("tecnicismos-0").length, 1);
  assert.equal(rects.get("tecnicismos-1").length, 1);
  assert.ok(rects.get("tecnicismos-0")[0].left > rects.get("tecnicismos-1")[0].left);
});

test("rangoCanvasCoincideConFuenteNormalizada compara contra normalizedLower", () => {
  const highlighter = loadHighlighter();
  const canvasModel = {
    docStart: 0,
    docEnd: "RESOLUCIÓN".length,
    confidence: "resolved",
    normalizedText: "RESOLUCIÓN",
    normalizedLower: "resolución",
  };
  const normalizedSource = {
    normalizedText: "resolución",
    normalizedLower: "resolución",
  };

  assert.equal(
    highlighter.rangoCanvasCoincideConFuenteNormalizada(
      canvasModel,
      normalizedSource,
      0,
      "RESOLUCIÓN".length,
    ),
    true,
  );
});

test("mapearIssuesARectangulosDesdeCanvas traduce ordinales globales a ordinales locales del viewport", () => {
  const highlighter = loadHighlighter();
  const sourceText = "encabezado resolución resolución resolución cierre único";
  const hiddenDocStart = sourceText.indexOf("resolución");
  const firstDocStart = sourceText.indexOf("resolución", hiddenDocStart + 1);
  const secondDocStart = sourceText.indexOf("resolución", firstDocStart + 1);
  const viewportText = "resolución resolución cierre único";
  const sortedFragments = [
    {
      text: viewportText,
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);
  const [firstVisibleStart, secondVisibleStart] = findAllOccurrences(
    canvasTextModel.normalizedText,
    "resolución",
  );

  highlighter.establecerAccionesReviewer({ sourceText });
  highlighter.issues = [
    {
      id: "tecnicismos-1",
      regla: "tecnicismos",
      textoOriginal: "resolución",
      normalizedStart: firstDocStart,
      normalizedEnd: firstDocStart + "resolución".length,
      ordinalExacto: 1,
      ordinalMinusculas: 1,
    },
    {
      id: "tecnicismos-2",
      regla: "tecnicismos",
      textoOriginal: "resolución",
      normalizedStart: secondDocStart,
      normalizedEnd: secondDocStart + "resolución".length,
      ordinalExacto: 2,
      ordinalMinusculas: 2,
    },
  ];

  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(
    sortedFragments,
    canvasTextModel,
  );

  assert.equal(rects.get("tecnicismos-1").length, 1);
  assert.equal(rects.get("tecnicismos-2").length, 1);
  assert.ok(rects.get("tecnicismos-1")[0].left < rects.get("tecnicismos-2")[0].left);
  assert.ok(firstVisibleStart < secondVisibleStart);
});

test("mapearIssuesARectangulosDesdeCanvas no asigna una ocurrencia visible a un issue fuera del viewport sin contexto coincidente", () => {
  const highlighter = loadHighlighter();
  const sortedFragments = [
    {
      text: "al inicio in fine visible.",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);

  highlighter.issues = [
    {
      id: "arcaismos-0",
      regla: "arcaismos",
      textoOriginal: "in fine",
      normalizedStart: 99999,
      normalizedEnd: 100006,
      contextBeforeExact: "otro contexto completamente distinto",
      contextAfterExact: "que no aparece",
      contextBeforeLower: "otro contexto completamente distinto",
      contextAfterLower: "que no aparece",
    },
  ];

  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(
    sortedFragments,
    canvasTextModel,
  );

  assert.equal(rects.get("arcaismos-0").length, 0);
});

test("mapearIssuesARectangulosDesdeCanvas usa el contexto para distinguir duplicados visibles", () => {
  const highlighter = loadHighlighter();
  const sortedFragments = [
    {
      text: "uno in fine alfa dos in fine beta",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);
  const [firstStart, secondStart] = findAllOccurrences(
    canvasTextModel.normalizedText,
    "in fine",
  );

  highlighter.issues = [
    {
      id: "arcaismos-0",
      regla: "arcaismos",
      textoOriginal: "in fine",
      normalizedStart: 99990,
      normalizedEnd: 99997,
      contextBeforeExact: "uno ",
      contextAfterExact: " alfa",
      contextBeforeLower: "uno ",
      contextAfterLower: " alfa",
    },
    {
      id: "arcaismos-1",
      regla: "arcaismos",
      textoOriginal: "in fine",
      normalizedStart: 99999,
      normalizedEnd: 100006,
      contextBeforeExact: " dos ",
      contextAfterExact: " beta",
      contextBeforeLower: " dos ",
      contextAfterLower: " beta",
    },
  ];

  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(
    sortedFragments,
    canvasTextModel,
  );

  assert.equal(rects.get("arcaismos-0").length, 1);
  assert.equal(rects.get("arcaismos-1").length, 1);
  assert.ok(rects.get("arcaismos-0")[0].left < rects.get("arcaismos-1")[0].left);
  assert.ok(firstStart < secondStart);
});

test("encontrarMejorRangoEnTexto conserva el orden esperado para duplicados idénticos", () => {
  const highlighter = loadHighlighter();
  const text = "resolución resolución resolución";

  highlighter.issues = [
    { id: "tecnicismos-0", textoOriginal: "resolución" },
    { id: "tecnicismos-1", textoOriginal: "resolución" },
    { id: "tecnicismos-2", textoOriginal: "resolución" },
  ];

  const secondRange = highlighter.encontrarMejorRangoEnTexto(
    {
      scope: "document",
      normalizedText: text,
      normalizedLower: text.toLocaleLowerCase(),
    },
    highlighter.issues[1],
    null,
  );

  const thirdRange = highlighter.encontrarMejorRangoEnTexto(
    {
      scope: "document",
      normalizedText: text,
      normalizedLower: text.toLocaleLowerCase(),
    },
    highlighter.issues[2],
    null,
  );

  assert.equal(secondRange.start, text.indexOf("resolución", 1));
  assert.equal(thirdRange.start, text.lastIndexOf("resolución"));
});

test("obtenerOrdinalTextoIssue usa el ordinal precomputado para desambiguar substrings", () => {
  const highlighter = loadHighlighter();
  // issue-0 contiene el needle de issue-1 como substring. Sin el ordinal
  // precomputado, ambos issues caerian sobre la misma ocurrencia visible.
  highlighter.issues = [
    {
      id: "voz-pasiva-0",
      textoOriginal: "las partes que la sentencia fue dictada por este Tribunal",
      ordinalExacto: 0,
      ordinalMinusculas: 0,
    },
    {
      id: "voz-pasiva-1",
      textoOriginal: "la sentencia fue dictada por este Tribunal",
      // En el doc, este needle aparece una vez dentro de issue-0 antes de
      // la posicion propia: ordinal 1.
      ordinalExacto: 1,
      ordinalMinusculas: 1,
    },
  ];

  assert.equal(
    highlighter.obtenerOrdinalTextoIssue(highlighter.issues[1], {
      caseSensitive: false,
    }),
    1,
  );
  assert.equal(
    highlighter.obtenerOrdinalTextoIssue(highlighter.issues[1], {
      caseSensitive: true,
    }),
    1,
  );
});

test("construirModeloTextoCanvas colapsa marcas bidi insertadas por Google Docs", () => {
  const highlighter = loadHighlighter();
  // Google Docs envuelve cada fragment con PDF (U+202C) y LRO (U+202D)
  // al renderizar en canvas. El modelo normalizado debe ignorarlas.
  const sortedFragments = [
    {
      text: "\u202Dla sentencia fue dictada por\u202C",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "\u202Deste Tribunal.\u202C",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 48,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];

  const model = highlighter.construirModeloTextoCanvas(sortedFragments);
  assert.equal(
    model.normalizedLower.indexOf("la sentencia fue dictada por este tribunal."),
    0,
    `texto normalizado inesperado: "${model.normalizedText}"`,
  );
});

test("normalizarTextoOrigenConMapa colapsa las mismas marcas invisibles que canvas", () => {
  const highlighter = loadHighlighter();
  const source = "\u202Dla sentencia\u202C fue dictada";
  const normalized = highlighter.normalizarTextoOrigenConMapa(source);

  assert.equal(normalized.normalizedText, " la sentencia fue dictada");
  assert.equal(
    highlighter.normalizarTextoExacto(source),
    "la sentencia fue dictada",
  );
});

test("mapearIssuesARectangulosDesdeCanvas genera un rect por linea para un issue multilinea", () => {
  const highlighter = loadHighlighter();
  // Simula una linea que termina en "por" y otra linea que empieza en "tanto".
  const sortedFragments = [
    {
      text: "esto fue realizado por",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "tanto el tribunal.",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 48,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.construirModeloTextoCanvas(sortedFragments);

  highlighter.logDebug = () => {};
  highlighter.issues = [
    {
      id: "archaismos-multilinea",
      regla: "archaismos",
      textoOriginal: "por tanto",
      // Indices de doc completo, intencionalmente fuera del rango visible
      // para forzar el fallback por texto (caso realista).
      normalizedStart: 99999,
      normalizedEnd: 99999 + "por tanto".length,
      contextBeforeExact: "realizado ",
      contextAfterExact: " el tribunal.",
      contextBeforeLower: "realizado ",
      contextAfterLower: " el tribunal.",
    },
  ];
  highlighter.obtenerRectEditor = () => null;

  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(
    sortedFragments,
    canvasTextModel,
  );

  const issueRects = rects.get("archaismos-multilinea");
  assert.ok(issueRects, "el issue deberia tener rects asignados");
  assert.equal(
    issueRects.length,
    2,
    `se esperaba un rect por linea, recibidos ${issueRects.length}`,
  );
  assert.ok(
    issueRects[0].top < issueRects[1].top ||
      issueRects[1].top < issueRects[0].top,
    "los rects deben estar en lineas distintas",
  );
});

test("construirModelosTextoPorCanvas resuelve un canvas duplicado usando vecinos", () => {
  const highlighter = loadHighlighter();
  const sourceText =
    "inicio unico A. seccion repetida. medio unico B. seccion repetida. final.";

  highlighter.establecerAccionesReviewer({ sourceText });

  const canvasModels = highlighter.construirModelosTextoPorCanvas([
    crearCanvasDataTexto("medio unico B.", { top: 0 }),
    crearCanvasDataTexto("seccion repetida.", { top: 100 }),
  ]);

  const uniqueModel = canvasModels[0];
  const repeatedModel = canvasModels[1];

  assert.equal(uniqueModel.docStart, sourceText.indexOf("medio unico B."));
  assert.equal(uniqueModel.confidence, "exact");
  assert.equal(
    repeatedModel.docStart,
    sourceText.lastIndexOf("seccion repetida."),
  );
  assert.equal(repeatedModel.confidence, "neighbor");
});

test("mapearIssuesARectangulosDesdeCanvas reparte un issue que cruza dos canvases", () => {
  const highlighter = loadHighlighter();
  const sourceText = "abc por tanto xyz";
  const issueStart = sourceText.indexOf("por");

  highlighter.establecerAccionesReviewer({ sourceText });
  highlighter.issues = [
    {
      id: "arcaismos-cruza-canvas",
      regla: "arcaismos",
      textoOriginal: "por tanto",
      normalizedStart: issueStart,
      normalizedEnd: issueStart + "por tanto".length,
      contextBeforeExact: "abc ",
      contextAfterExact: " xyz",
      contextBeforeLower: "abc ",
      contextAfterLower: " xyz",
    },
  ];

  const canvasModels = highlighter.construirModelosTextoPorCanvas([
    crearCanvasDataTexto("abc por", { top: 0 }),
    crearCanvasDataTexto("tanto xyz", { top: 100 }),
  ]);
  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(canvasModels);
  const issueRects = rects.get("arcaismos-cruza-canvas");

  assert.equal(issueRects.length, 2);
  assert.ok(issueRects[0].top < issueRects[1].top);
});

test("mapearIssuesARectangulosDesdeCanvas no asigna un issue offscreen a texto visible identico", () => {
  const highlighter = loadHighlighter();
  const sourceText = "visible in fine. oculto in fine.";
  const hiddenStart = sourceText.lastIndexOf("in fine");

  highlighter.establecerAccionesReviewer({ sourceText });
  highlighter.issues = [
    {
      id: "arcaismos-hidden",
      regla: "arcaismos",
      textoOriginal: "in fine",
      normalizedStart: hiddenStart,
      normalizedEnd: hiddenStart + "in fine".length,
      contextBeforeExact: "oculto ",
      contextAfterExact: ".",
      contextBeforeLower: "oculto ",
      contextAfterLower: ".",
    },
  ];

  const canvasModels = highlighter.construirModelosTextoPorCanvas([
    crearCanvasDataTexto("visible in fine.", { top: 0 }),
  ]);
  const rects = highlighter.mapearIssuesARectangulosDesdeCanvas(canvasModels);

  assert.equal(rects.get("arcaismos-hidden").length, 0);
});

test("enfocarIssueOffscreen itera scroll hacia abajo hasta que aparecen rects", async () => {
  const highlighter = loadHighlighter();
  const issue = {
    id: "arcaismos-target",
    inicio: 250,
    normalizedStart: 250,
  };
  const rect = {
    left: 10,
    right: 40,
    top: 50,
    bottom: 64,
    width: 30,
    height: 14,
  };
  const container = {
    scrollTop: 0,
    scrollHeight: 3000,
    clientHeight: 400,
    scrollBy({ top }) {
      this.scrollTop += top;
      scrolls.push(top);
    },
  };
  const scrolls = [];
  const calls = [];
  let recalcs = 0;

  highlighter.establecerAccionesReviewer({
    sourceText: "x".repeat(500),
    obtenerIssue() {
      return issue;
    },
  });
  highlighter.obtenerContenedorDesplazamiento = () => container;
  highlighter.esperarCanvasRendered = async () => {};
  highlighter.recalcularPosiciones = async () => {
    recalcs += 1;
    if (recalcs === 1) {
      highlighter.currentDocumentViewport = { minDocStart: 0, maxDocEnd: 100 };
      highlighter.currentRects = new Map();
    } else if (recalcs === 2) {
      highlighter.currentDocumentViewport = {
        minDocStart: 100,
        maxDocEnd: 200,
      };
      highlighter.currentRects = new Map();
    } else {
      highlighter.currentDocumentViewport = {
        minDocStart: 200,
        maxDocEnd: 300,
      };
      highlighter.currentRects = new Map([[issue.id, [rect]]]);
    }
  };
  highlighter.desplazarRectanguloAVistaSiNecesario = () => {
    calls.push("scroll-into-view");
  };
  highlighter.establecerIssueActivo = () => {
    calls.push("set-active");
  };
  highlighter.mostrarDestelloFoco = () => {
    calls.push("flash");
  };
  highlighter.reposicionarDestelloTrasCroll = () => {};

  const focused = await highlighter.enfocarIssueOffscreen(issue.id);

  assert.equal(focused, true);
  assert.equal(scrolls.length, 2);
  assert.ok(scrolls.every((delta) => delta > 0));
  assert.deepEqual(calls.slice(0, 2), ["scroll-into-view", "set-active"]);
});

test("enfocarIssueOffscreen corrige direccion y reduce el paso tras overshoot", async () => {
  const highlighter = loadHighlighter();
  const issue = {
    id: "arcaismos-target",
    inicio: 250,
    normalizedStart: 250,
  };
  const rect = {
    left: 10,
    right: 40,
    top: 50,
    bottom: 64,
    width: 30,
    height: 14,
  };
  const container = {
    scrollTop: 1200,
    scrollHeight: 3000,
    clientHeight: 400,
    scrollBy({ top }) {
      this.scrollTop += top;
      scrolls.push(top);
    },
  };
  const scrolls = [];
  let recalcs = 0;

  highlighter.establecerAccionesReviewer({
    sourceText: "x".repeat(500),
    obtenerIssue() {
      return issue;
    },
  });
  highlighter.obtenerContenedorDesplazamiento = () => container;
  highlighter.esperarCanvasRendered = async () => {};
  highlighter.recalcularPosiciones = async () => {
    recalcs += 1;
    if (recalcs === 1) {
      highlighter.currentDocumentViewport = {
        minDocStart: 400,
        maxDocEnd: 500,
      };
      highlighter.currentRects = new Map();
    } else if (recalcs === 2) {
      highlighter.currentDocumentViewport = {
        minDocStart: 100,
        maxDocEnd: 200,
      };
      highlighter.currentRects = new Map();
    } else {
      highlighter.currentDocumentViewport = {
        minDocStart: 200,
        maxDocEnd: 300,
      };
      highlighter.currentRects = new Map([[issue.id, [rect]]]);
    }
  };
  highlighter.desplazarRectanguloAVistaSiNecesario = () => {};
  highlighter.establecerIssueActivo = () => {};
  highlighter.mostrarDestelloFoco = () => {};
  highlighter.reposicionarDestelloTrasCroll = () => {};

  const focused = await highlighter.enfocarIssueOffscreen(issue.id);

  assert.equal(focused, true);
  assert.equal(scrolls.length, 2);
  assert.ok(scrolls[0] < 0);
  assert.ok(scrolls[1] > 0);
  assert.ok(Math.abs(scrolls[1]) < Math.abs(scrolls[0]));
});
