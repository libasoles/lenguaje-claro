const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

function loadHighlighter() {
  const measureContext = {
    font: "16px sans-serif",
    measureText(text) {
      const width = String(text || "").length;
      return {
        width,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
      };
    },
  };
  const windowListeners = new Map();
  const window = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set());
      }
      windowListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      windowListeners.get(type)?.delete(handler);
    },
  };
  const sandbox = {
    console,
    Map,
    Set,
    chrome: {
      runtime: {
        getURL(pathname) {
          return `chrome-extension://test/${pathname}`;
        },
      },
    },
    document: {
      createElement(tagName) {
        if (tagName !== "canvas") {
          return {};
        }

        return {
          getContext() {
            return measureContext;
          },
        };
      },
    },
    window,
  };

  const { exports } = loadBrowserModule({
    projectRoot,
    sandbox,
    filename: "tests/highlighter-entry.js",
    source: `export { DocsHighlighter } from "./content/highlighter.js";`,
  });

  return exports.DocsHighlighter;
}

test("mergeIssueRects conserva rects DOM y completa faltantes desde canvas", () => {
  const highlighter = loadHighlighter();

  const domIssueRects = new Map([
    ["arcaismos-0", [{ left: 10, top: 10, right: 30, bottom: 20, width: 20, height: 10 }]],
    ["voz-pasiva-0", []],
  ]);
  const canvasIssueRects = new Map([
    ["arcaismos-0", [{ left: 12, top: 12, right: 32, bottom: 22, width: 20, height: 10 }]],
    ["voz-pasiva-0", [{ left: 40, top: 10, right: 100, bottom: 20, width: 60, height: 10 }]],
  ]);

  const merged = highlighter.mergeIssueRects(domIssueRects, canvasIssueRects);

  assert.deepEqual(merged.get("arcaismos-0"), domIssueRects.get("arcaismos-0"));
  assert.deepEqual(merged.get("voz-pasiva-0"), canvasIssueRects.get("voz-pasiva-0"));
  assert.equal(highlighter.countVisibleIssueRects(merged), 2);
});

test("aplicarHighlights espera al text root antes del primer recálculo", async () => {
  const highlighter = loadHighlighter();
  const calls = [];
  let resolveWaitForTextRoot;

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderMarkers = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.scheduleRecalculate = () => {
    calls.push("schedule");
  };
  highlighter.observeTextRoot = () => {
    calls.push("observe");
  };
  highlighter.scheduleBootstrapRetry = () => {
    calls.push("bootstrap");
  };
  highlighter.waitForTextRoot = () =>
    new Promise((resolve) => {
      resolveWaitForTextRoot = resolve;
    });

  const pending = highlighter.aplicarHighlights([{ id: "arcaismos-0" }]);

  await Promise.resolve();

  assert.deepEqual(calls, ["init", "render:0"]);

  resolveWaitForTextRoot({
    getAttribute() {
      return null;
    },
  });
  await pending;
});

test("aplicarHighlights agenda el primer recálculo y luego observa cuando aparece el text root", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderMarkers = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.scheduleRecalculate = () => {
    calls.push("schedule");
  };
  highlighter.observeTextRoot = () => {
    calls.push("observe");
  };
  highlighter.scheduleBootstrapRetry = () => {
    calls.push("bootstrap");
  };
  highlighter.waitForTextRoot = async () => ({
    getAttribute() {
      return null;
    },
  });

  await highlighter.aplicarHighlights([{ id: "arcaismos-0" }]);

  assert.deepEqual(calls, [
    "init",
    "render:0",
    "schedule",
    "observe",
    "bootstrap",
  ]);
});

test("aplicarHighlights agenda un recálculo de fallback si waitForTextRoot vence", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderMarkers = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.scheduleRecalculate = () => {
    calls.push("schedule");
  };
  highlighter.observeTextRoot = () => {
    calls.push("observe");
  };
  highlighter.scheduleBootstrapRetry = () => {
    calls.push("bootstrap");
  };
  highlighter.waitForTextRoot = async () => null;

  await highlighter.aplicarHighlights([{ id: "arcaismos-0" }]);

  assert.deepEqual(calls, [
    "init",
    "render:0",
    "schedule",
    "observe",
    "bootstrap",
  ]);
});

test("aplicarHighlights preserva markers visibles durante reanálisis en segundo plano", async () => {
  const highlighter = loadHighlighter();
  const calls = [];

  highlighter.inicializar = () => {
    calls.push("init");
  };
  highlighter.renderMarkers = (issueRects) => {
    highlighter.currentRects = issueRects;
    calls.push(`render:${issueRects.size}`);
  };
  highlighter.scheduleRecalculate = () => {
    calls.push("schedule");
  };
  highlighter.observeTextRoot = () => {
    calls.push("observe");
  };
  highlighter.scheduleBootstrapRetry = () => {
    calls.push("bootstrap");
  };
  highlighter.waitForTextRoot = async () => ({
    getAttribute() {
      return null;
    },
  });

  await highlighter.aplicarHighlights([{ id: "arcaismos-0" }], {
    preserveVisibleState: true,
  });

  assert.deepEqual(calls, ["init", "schedule", "observe", "bootstrap"]);
});

test("limpiar preserva el cache de canvas si se pide explícitamente", () => {
  const highlighter = loadHighlighter();

  highlighter._lastRenderedCanvasData = [{ fragments: [{ text: "texto" }] }];
  highlighter._lastRenderedCanvasAt = 1234;
  highlighter.issueMarkers = new Map();

  highlighter.limpiar({ preserveCanvasCache: true });

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
  highlighter.hidePopup = () => {
    removed.push("popup");
  };

  highlighter.limpiar({ preserveMarkers: true });

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

test("syncIssuesWithRects deja visible un issue recuperado por fallback", () => {
  const highlighter = loadHighlighter();

  highlighter.issues = [
    { id: "arcaismos-0", rects: [], isVisible: false },
    { id: "voz-pasiva-0", rects: [], isVisible: false },
  ];

  highlighter.syncIssuesWithRects(
    new Map([
      ["arcaismos-0", [{ left: 10, top: 10, right: 30, bottom: 20, width: 20, height: 10 }]],
      ["voz-pasiva-0", [{ left: 40, top: 10, right: 100, bottom: 20, width: 60, height: 10 }]],
    ]),
  );

  assert.equal(highlighter.issues[0].isVisible, true);
  assert.equal(highlighter.issues[1].isVisible, true);
  assert.equal(highlighter.issues[1].rects.length, 1);
});

test("findBestNeedleRange encuentra voz pasiva aunque falten separadores exactos", () => {
  const highlighter = loadHighlighter();

  const match = highlighter.findBestNeedleRange(
    "la sentencia fue dictada por estetribunal en la fecha de ayer",
    "fue dictada por este tribunal",
    10,
  );

  assert.equal(match.start, 13);
  assert.equal(match.end, 41);
});

test("buildCanvasTextModel no inserta espacios sintéticos entre fragmentos pegados", () => {
  const highlighter = loadHighlighter();

  const model = highlighter.buildCanvasTextModel([
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

test("buildCanvasTextModel sí inserta espacios entre palabras separadas", () => {
  const highlighter = loadHighlighter();

  const model = highlighter.buildCanvasTextModel([
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

test("buildSortedFragments mantiene el orden izquierda-derecha cuando la baseline sigue dentro del mismo renglón", () => {
  const highlighter = loadHighlighter();

  const fragments = highlighter.buildSortedFragments([
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

test("computeFragmentPortionRect respeta textBaseline top y no desplaza el rect hacia arriba", () => {
  const highlighter = loadHighlighter();

  const rect = highlighter.computeFragmentPortionRect(
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

test("computeRectsFromCanvasIndices devuelve un rect por cada línea al cruzar un wrap", () => {
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

  const canvasTextModel = highlighter.buildCanvasTextModel(sortedFragments);
  const needle = highlighter.normalizeText("fue dictada por este Tribunal");
  const match = highlighter.findBestNeedleRange(
    canvasTextModel.normalizedLower,
    needle,
    0,
  );
  const rects = highlighter.computeRectsFromCanvasIndices(
    sortedFragments,
    canvasTextModel.charMap,
    match.start,
    match.end,
  );

  assert.equal(rects.length, 2);
  assert.ok(rects[1].top > rects[0].top);
});

test("mapIssuesToRects reubica instancias repetidas cuando solo cambia el casing", () => {
  const highlighter = loadHighlighter();
  const text = "resolución judicial firme. RESOLUCIÓN DEL CONTRATO";
  const lowerStart = text.indexOf("resolución");
  const upperStart = text.indexOf("RESOLUCIÓN");

  highlighter.logDebug = () => {};
  highlighter.normalizeRects = (rects) => rects;
  highlighter.createRangeFromIndices = (_charMap, start, end) => ({
    getClientRects() {
      return [
        {
          left: start,
          top: start,
          right: end,
          bottom: start + 10,
          width: end - start,
          height: 10,
        },
      ];
    },
  });
  highlighter.issues = [
    {
      id: "tecnicismos-0",
      regla: "tecnicismos",
      textoOriginal: "RESOLUCIÓN",
      sugerencias: ["CANCELACIÓN", "TERMINACIÓN"],
      normalizedStart: lowerStart,
      normalizedEnd: lowerStart + "RESOLUCIÓN".length,
    },
    {
      id: "tecnicismos-1",
      regla: "tecnicismos",
      textoOriginal: "resolución",
      sugerencias: ["cancelación", "terminación"],
      normalizedStart: upperStart,
      normalizedEnd: upperStart + "resolución".length,
    },
  ];

  const rects = highlighter.mapIssuesToRects({
    normalizedText: text,
    normalizedLower: text.toLocaleLowerCase(),
    charMap: Array.from({ length: text.length }, () => ({ node: {}, offset: 0 })),
  });

  assert.equal(rects.get("tecnicismos-0")[0].left, upperStart);
  assert.equal(rects.get("tecnicismos-1")[0].left, lowerStart);

  const upperPopup = highlighter.renderPopupHTML({
    ...highlighter.issues[0],
    reglaNombre: "Tecnicismo",
    color: "#e67e22",
  });
  const lowerPopup = highlighter.renderPopupHTML({
    ...highlighter.issues[1],
    reglaNombre: "Tecnicismo",
    color: "#e67e22",
  });

  assert.match(upperPopup, /RESOLUCIÓN/);
  assert.match(upperPopup, /CANCELACIÓN/);
  assert.match(lowerPopup, /resolución/);
  assert.match(lowerPopup, /cancelación/);
});

test("mapIssuesToRectsFromCanvas no cruza issue ids entre duplicados con distinto casing", () => {
  const highlighter = loadHighlighter();
  const sortedFragments = [
    {
      text: "resolución judicial firme.",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 20,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
    {
      text: "RESOLUCIÓN DEL CONTRATO",
      font: "16px sans-serif",
      textAlign: "left",
      textBaseline: "alphabetic",
      viewportBaselineX: 0,
      viewportBaselineY: 48,
      viewportScaleX: 1,
      viewportScaleY: 1,
    },
  ];
  const canvasTextModel = highlighter.buildCanvasTextModel(sortedFragments);
  const lowerStart = canvasTextModel.normalizedText.indexOf("resolución");
  const upperStart = canvasTextModel.normalizedText.indexOf("RESOLUCIÓN");

  highlighter.logDebug = () => {};
  highlighter.issues = [
    {
      id: "tecnicismos-0",
      regla: "tecnicismos",
      textoOriginal: "RESOLUCIÓN",
      normalizedStart: lowerStart,
      normalizedEnd: lowerStart + "RESOLUCIÓN".length,
    },
    {
      id: "tecnicismos-1",
      regla: "tecnicismos",
      textoOriginal: "resolución",
      normalizedStart: upperStart,
      normalizedEnd: upperStart + "resolución".length,
    },
  ];

  const rects = highlighter.mapIssuesToRectsFromCanvas(
    sortedFragments,
    canvasTextModel,
  );

  assert.equal(rects.get("tecnicismos-0").length, 1);
  assert.equal(rects.get("tecnicismos-1").length, 1);
  assert.ok(rects.get("tecnicismos-0")[0].top > rects.get("tecnicismos-1")[0].top);
});

test("findBestTextRange conserva el orden esperado para duplicados idénticos", () => {
  const highlighter = loadHighlighter();
  const text = "resolución resolución resolución";

  highlighter.issues = [
    { id: "tecnicismos-0", textoOriginal: "resolución" },
    { id: "tecnicismos-1", textoOriginal: "resolución" },
    { id: "tecnicismos-2", textoOriginal: "resolución" },
  ];

  const secondRange = highlighter.findBestTextRange(
    {
      normalizedText: text,
      normalizedLower: text.toLocaleLowerCase(),
    },
    highlighter.issues[1],
    null,
  );

  const thirdRange = highlighter.findBestTextRange(
    {
      normalizedText: text,
      normalizedLower: text.toLocaleLowerCase(),
    },
    highlighter.issues[2],
    null,
  );

  assert.equal(secondRange.start, text.indexOf("resolución", 1));
  assert.equal(thirdRange.start, text.lastIndexOf("resolución"));
});
