const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const highlighterSource = fs.readFileSync(
  path.join(projectRoot, "content", "highlighter.js"),
  "utf8",
);

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
  const sandbox = {
    console,
    Map,
    Set,
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
    window: {},
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${highlighterSource}\nthis.__DocsHighlighter = DocsHighlighter;`,
    sandbox,
    { filename: "content/highlighter.js" },
  );
  return sandbox.__DocsHighlighter;
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
