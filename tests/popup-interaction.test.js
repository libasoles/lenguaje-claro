const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

function createMockElement() {
  return {
    style: {},
    className: "",
    innerHTML: "",
    dataset: {},
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

function loadReviewer(options = {}) {
  const body = createMockElement();
  const sandbox = {
    console,
    Promise,
    Map,
    Set,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    requestAnimationFrame(callback) {
      return (options.setTimeout || setTimeout)(callback, 0);
    },
    cancelAnimationFrame(timerId) {
      return (options.clearTimeout || clearTimeout)(timerId);
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
      setTimeout: options.setTimeout || setTimeout,
      clearTimeout: options.clearTimeout || clearTimeout,
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
    filename: "tests/popup-interaction-entry.js",
    source: `
      import "./scripts/jsx-runtime.js";
      export { Orchestrator } from "./content/content.js";
      export { DocsHighlighter } from "./content/highlighter.jsx";
    `,
  });

  return exports;
}

test("reanalizarTrasEdicion espera mientras el popup sigue visible", () => {
  const timers = createFakeTimers();
  const { Orchestrator, DocsHighlighter } = loadReviewer({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const calls = [];

  Orchestrator.analizarDocumento = async (options = {}) => {
    calls.push(options);
  };
  DocsHighlighter.popupElement = {
    classList: {
      contains() {
        return false;
      },
    },
  };
  DocsHighlighter.visiblePopupIssueId = "arcaismos-0";

  Orchestrator.reanalizarTrasEdicion();

  let pendingTimers = timers.pending();
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 700);

  timers.run(pendingTimers[0].id);

  assert.deepEqual(calls, []);
  pendingTimers = timers.pending();
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 250);

  DocsHighlighter.visiblePopupIssueId = null;
  timers.run(pendingTimers[0].id);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].preservarPanel, true);
  assert.equal(calls[0].silencioso, true);
  assert.equal(calls[0].invalidarCacheCanvas, true);
});

test("ocultarPopup resetea hover cuando se cierra por código", () => {
  const { DocsHighlighter } = loadReviewer();
  let hiddenClassAdded = false;

  DocsHighlighter.popupElement = {
    innerHTML: "<button>Aplicar</button>",
    dataset: {
      issueId: "arcaismos-0",
    },
    classList: {
      add(className) {
        if (className === "docs-reviewer-popup-hidden") {
          hiddenClassAdded = true;
        }
      },
    },
  };
  DocsHighlighter.isPopupHovered = true;
  DocsHighlighter.visiblePopupIssueId = "arcaismos-0";

  DocsHighlighter.ocultarPopup();

  assert.equal(DocsHighlighter.isPopupHovered, false);
  assert.equal(DocsHighlighter.visiblePopupIssueId, null);
  assert.equal(DocsHighlighter.popupElement.innerHTML, "");
  assert.equal("issueId" in DocsHighlighter.popupElement.dataset, false);
  assert.equal(hiddenClassAdded, true);
});
