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

function loadDocsEditor() {
  const calls = [];
  const iframeWindow = {
    focus() {
      calls.push("window-focus");
    },
  };
  const editable = {
    ownerDocument: {
      defaultView: iframeWindow,
    },
    focus() {
      calls.push("editable-focus");
    },
    dispatchEvent(event) {
      calls.push(`dispatch:${event.type}`);
      return true;
    },
  };
  const iframeDocument = {
    querySelector(selector) {
      if (selector === '[contenteditable="true"]') {
        return editable;
      }
      return null;
    },
  };
  const sandbox = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    window: {
      location: {
        href: "https://docs.google.com/document/d/test-doc/edit",
      },
    },
    document: {
      documentElement: {
        dataset: {},
      },
      querySelector(selector) {
        if (selector === "iframe.docs-texteventtarget-iframe") {
          return {
            contentDocument: iframeDocument,
          };
        }
        return null;
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
    },
    chrome: {
      runtime: {
        id: "test-extension",
        sendMessage(_message, callback) {
          callback({ text: "", segments: [] });
        },
      },
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
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  };

  const { exports } = loadBrowserModule({
    projectRoot,
    sandbox,
    filename: "tests/docs-editor-entry.js",
    source: `
      export { DocsEditor } from "./content/docs-editor.js";
    `,
  });

  return {
    DocsEditor: exports.DocsEditor,
    calls,
  };
}

test("aplicarReemplazo devuelve foco al editor antes de seleccionar y disparar beforeinput", async () => {
  const { DocsEditor, calls } = loadDocsEditor();

  DocsEditor.establecerSeleccion = async () => {
    calls.push("set-selection");
  };

  await DocsEditor.aplicarReemplazo({
    inicio: 1,
    fin: 2,
    textoReemplazo: "x",
  });

  const windowFocusIndex = calls.findIndex((entry) => entry === "window-focus");
  const editableFocusIndex = calls.findIndex(
    (entry) => entry === "editable-focus",
  );
  const setSelectionIndex = calls.findIndex((entry) => entry === "set-selection");
  const dispatchIndex = calls.findIndex(
    (entry) => entry === "dispatch:beforeinput",
  );

  assert.ok(windowFocusIndex !== -1);
  assert.ok(editableFocusIndex !== -1);
  assert.ok(setSelectionIndex !== -1);
  assert.ok(dispatchIndex !== -1);
  assert.ok(windowFocusIndex < setSelectionIndex);
  assert.ok(editableFocusIndex < setSelectionIndex);
  assert.ok(setSelectionIndex < dispatchIndex);
});

test("aplicarReemplazo usa el ordinal del issue para elegir la ocurrencia correcta", async () => {
  const { DocsEditor } = loadDocsEditor();
  const textoOriginal = "susodicho";
  const textoViejo = "Alpha susodicho. Beta susodicho.";
  const textoAccesor = "Alpha susodicho. Texto agregado muy largo. Beta susodicho.";
  const ocurrenciasViejas = findAllOccurrences(textoViejo, textoOriginal);
  const ocurrenciasActuales = findAllOccurrences(textoAccesor, textoOriginal);
  const selecciones = [];

  DocsEditor.pedirAccesorTexto = async () => textoAccesor;
  DocsEditor.establecerSeleccion = async (inicio, fin) => {
    selecciones.push({ inicio, fin });
  };

  await DocsEditor.aplicarReemplazo({
    inicio: ocurrenciasViejas[1],
    fin: ocurrenciasViejas[1] + textoOriginal.length,
    textoOriginal,
    textoReemplazo: "mencionado",
    ordinalExacto: 1,
    ordinalMinusculas: 1,
  });

  assert.deepEqual(selecciones, [
    {
      inicio: ocurrenciasActuales[1],
      fin: ocurrenciasActuales[1] + textoOriginal.length,
    },
  ]);
});

test("aplicarReemplazo falla si no puede distinguir con certeza la ocurrencia correcta", async () => {
  const { DocsEditor } = loadDocsEditor();
  const textoOriginal = "susodicho";
  const textoViejo = "Uno susodicho. Dos susodicho.";
  const textoAccesor = "Uno susodicho. Texto agregado muy largo. Dos susodicho.";
  const ocurrenciasViejas = findAllOccurrences(textoViejo, textoOriginal);

  DocsEditor.pedirAccesorTexto = async () => textoAccesor;
  DocsEditor.establecerSeleccion = async () => {
    throw new Error("no deberia intentar seleccionar");
  };

  await assert.rejects(
    DocsEditor.aplicarReemplazo({
      inicio: ocurrenciasViejas[1],
      fin: ocurrenciasViejas[1] + textoOriginal.length,
      textoOriginal,
      textoReemplazo: "mencionado",
    }),
    /No se pudo ubicar "susodicho" de forma segura/,
  );
});
