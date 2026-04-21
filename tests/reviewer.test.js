const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

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

function createMockElement() {
  return {
    style: {},
    className: "",
    innerHTML: "",
    appendChild(node) {
      node.parentNode = this;
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    remove() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
  };
}

function loadReviewer() {
  const body = createMockElement();
  const sandbox = {
    console,
    Promise,
    Map,
    Set,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame(timerId) {
      clearTimeout(timerId);
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    DataTransfer: class DataTransfer {
      setData() {}
    },
    InputEvent: class InputEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    XMLHttpRequest: class XMLHttpRequest {
      open() {}
      send() {
        this.status = 200;
        this.responseText = JSON.stringify({
          globalExclusions: [],
          requiere_de_que: [],
          nunca_de_que: [],
        });
      }
    },
    window: {
      location: {
        href: "https://example.com/",
      },
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener() {},
      removeEventListener() {},
      getComputedStyle() {
        return {
          position: "static",
          overflowY: "visible",
        };
      },
      postMessage() {},
      scrollBy() {},
    },
    document: {
      body,
      documentElement: {
        dataset: {},
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      createElement() {
        return createMockElement();
      },
      querySelector() {
        return null;
      },
      getElementById() {
        return null;
      },
    },
    chrome: {
      runtime: {
        id: "test-extension",
        lastError: null,
        getURL(resourcePath) {
          return `chrome-extension://test/${resourcePath}`;
        },
        sendMessage(_message, callback) {
          callback({ text: "", segments: [] });
        },
      },
      storage: {
        local: {
          async get() {
            return {
              extensionEnabled: true,
              disabledDocs: [],
            };
          },
        },
      },
    },
  };

  const { exports } = loadBrowserModule({
    projectRoot,
    sandbox,
    filename: "tests/reviewer-entry.js",
    source: `
      import "./scripts/jsx-runtime.js";
      export { Orchestrator } from "./content/content.js";
      export { DocsPanel } from "./content/panel.jsx";
      export { DocsHighlighter } from "./content/highlighter.jsx";
      export { DocsReader } from "./content/reader.js";
    `,
  });

  return {
    ...exports,
    sandbox,
  };
}

test("analizarDocumento no limpia dos veces el highlighter durante reanálisis preservado", async () => {
  const { Orchestrator, DocsPanel, DocsHighlighter, DocsReader } =
    loadReviewer();
  const limpiarCalls = [];
  const aplicarCalls = [];

  Orchestrator.isInitialized = true;
  Orchestrator.allMatches = [{ id: "previo" }];
  DocsReader.leerDocumento = async () => ({
    text: "susodicho y susodicho",
    segments: [],
  });
  DocsPanel.actualizarIssues = () => {};
  DocsPanel.mostrarCargando = () => {};
  DocsHighlighter.limpiar = (options = {}) => {
    limpiarCalls.push(options);
  };
  DocsHighlighter.aplicarResaltados = async (_issues, options = {}) => {
    aplicarCalls.push(options);
  };

  await Orchestrator.analizarDocumento({ preservarPanel: true });

  assert.equal(limpiarCalls.length, 1);
  assert.equal(limpiarCalls[0].preservarCacheCanvas, true);
  assert.equal(limpiarCalls[0].preservarMarcadores, true);
  assert.equal(aplicarCalls.length, 1);
  assert.equal(aplicarCalls[0].preservarEstadoVisible, true);
});

test("enriquecerCoincidencias genera ids estables aunque cambie el offset absoluto", () => {
  const { Orchestrator } = loadReviewer();
  const needle = "susodicho";
  const buildMatches = (text) => {
    const [firstStart, secondStart] = findAllOccurrences(text, needle);

    return [
      {
        id: "arcaismos-0",
        inicio: firstStart,
        fin: firstStart + needle.length,
        textoOriginal: needle,
        sugerencias: ["mencionado"],
        regla: "arcaismos",
      },
      {
        id: "arcaismos-1",
        inicio: secondStart,
        fin: secondStart + needle.length,
        textoOriginal: needle,
        sugerencias: ["mencionado"],
        regla: "arcaismos",
      },
    ];
  };

  const textA = "A susodicho y susodicho";
  const textB = "XX A susodicho y susodicho";

  Orchestrator.sourceText = textA;
  const issuesA = Orchestrator.enriquecerCoincidencias(buildMatches(textA));

  Orchestrator.sourceText = textB;
  const issuesB = Orchestrator.enriquecerCoincidencias(buildMatches(textB));

  assert.notEqual(issuesA[0].id, "arcaismos-0");
  assert.equal(issuesA[0].id, issuesB[0].id);
  assert.equal(issuesA[1].id, issuesB[1].id);
  assert.notEqual(issuesA[0].id, issuesA[1].id);
});

test("enriquecerCoincidencias mantiene el id si cambia el ordinal por una edición previa", () => {
  const { Orchestrator } = loadReviewer();
  const needle = "susodicho";
  const textA =
    "susodicho. relleno relleno relleno clave unica susodicho final.";
  const textB = "relleno relleno relleno clave unica susodicho final.";
  const buildMatches = (text) =>
    findAllOccurrences(text, needle).map((start, index) => ({
      id: `arcaismos-${index}`,
      inicio: start,
      fin: start + needle.length,
      textoOriginal: needle,
      sugerencias: ["mencionado"],
      regla: "arcaismos",
    }));

  Orchestrator.sourceText = textA;
  const issuesA = Orchestrator.enriquecerCoincidencias(buildMatches(textA));
  const targetA = issuesA[1];

  Orchestrator.sourceText = textB;
  const issuesB = Orchestrator.enriquecerCoincidencias(buildMatches(textB));
  const targetB = issuesB[0];

  assert.equal(targetA.ordinalExacto, 1);
  assert.equal(targetB.ordinalExacto, 0);
  assert.equal(targetA.id, targetB.id);
});

test("aplicarCorreccion reenvia metadata estable del issue al editor", async () => {
  const { Orchestrator, DocsPanel, DocsHighlighter, sandbox } = loadReviewer();
  const issue = {
    id: "arcaismos-1",
    inicio: 18,
    fin: 27,
    textoOriginal: "susodicho",
    sugerencias: ["mencionado"],
    normalizedStart: 18,
    normalizedEnd: 27,
    ordinalExacto: 1,
    ordinalMinusculas: 1,
  };
  let applyArgs = null;

  Orchestrator.issuesById = new Map([[issue.id, issue]]);
  Orchestrator.allMatches = [issue];
  DocsPanel.eliminarIssueDePanel = () => {};
  DocsHighlighter.limpiar = () => {};
  DocsHighlighter.aplicarResaltados = async () => {};
  Orchestrator.analizarDocumento = async () => {};
  Orchestrator.reanalizarTrasEdicion = () => {};
  sandbox.window.DocsEditor.aplicarReemplazo = async (args) => {
    applyArgs = args;
  };

  await Orchestrator.aplicarCorreccion(issue.id);

  assert.equal(applyArgs?.inicio, issue.inicio);
  assert.equal(applyArgs?.fin, issue.fin);
  assert.equal(applyArgs?.textoOriginal, issue.textoOriginal);
  assert.equal(applyArgs?.textoReemplazo, issue.sugerencias[0]);
  assert.equal(applyArgs?.normalizedStart, issue.normalizedStart);
  assert.equal(applyArgs?.normalizedEnd, issue.normalizedEnd);
  assert.equal(applyArgs?.ordinalExacto, issue.ordinalExacto);
  assert.equal(applyArgs?.ordinalMinusculas, issue.ordinalMinusculas);
});

test("aplicarCorreccion reanaliza de inmediato con el texto local actualizado", async () => {
  const { Orchestrator, sandbox } = loadReviewer();
  const issue = {
    id: "arcaismos-1",
    inicio: 18,
    fin: 27,
    textoOriginal: "susodicho",
    sugerencias: ["mencionado"],
    normalizedStart: 18,
    normalizedEnd: 27,
    ordinalExacto: 1,
    ordinalMinusculas: 1,
  };
  let analyzeOptions = null;

  Orchestrator.issuesById = new Map([[issue.id, issue]]);
  Orchestrator.allMatches = [issue];
  sandbox.window.DocsEditor.aplicarReemplazo = async () => {};
  Orchestrator.analizarDocumento = async (options = {}) => {
    analyzeOptions = options;
  };
  Orchestrator.reanalizarTrasEdicion = () => {};

  await Orchestrator.aplicarCorreccion(issue.id);

  assert.equal(analyzeOptions?.preservarPanel, true);
  assert.equal(analyzeOptions?.silencioso, true);
  assert.equal(analyzeOptions?.invalidarCacheCanvas, true);
});
