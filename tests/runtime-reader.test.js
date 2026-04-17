const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

function createSandbox(runtimeOverrides = {}) {
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
    chrome: {
      runtime: {
        lastError: null,
        getURL(resourcePath) {
          return `chrome-extension://test/${resourcePath}`;
        },
        sendMessage(_message, callback) {
          callback({ text: "Documento", segments: [] });
        },
        ...runtimeOverrides,
      },
    },
  };

  const { exports, sandbox: context } = loadBrowserModule({
    projectRoot,
    sandbox,
    filename: "tests/runtime-reader-entry.js",
    source: `
      export { DocsRuntime } from "./content/runtime.js";
      export { DocsReader } from "./content/reader.js";
    `,
  });

  return { context, exports };
}

test("DocsReader normaliza el contexto invalidado cuando sendMessage falla sincronicamente", async () => {
  const { exports } = createSandbox({
    sendMessage() {
      throw new Error("Extension context invalidated.");
    },
  });

  const result = await exports.DocsReader.leerDocumento();
  const lastReadError = exports.DocsReader.lastReadError;

  assert.equal(result, null);
  assert.equal(lastReadError.code, "EXTENSION_CONTEXT_INVALIDATED");
  assert.match(lastReadError.message, /recargá la página/i);
});

test("DocsRuntime normaliza lastError del callback sin dejar rechazo no manejado", async () => {
  const { exports } = createSandbox({
    sendMessage(_message, callback) {
      this.lastError = {
        message:
          "Could not establish connection. Receiving end does not exist.",
      };
      callback();
      this.lastError = null;
    },
  });

  const error = await exports.DocsRuntime.sendMessage({ type: "PING" }).catch(
    (runtimeError) => ({
      code: runtimeError.code,
      message: runtimeError.message,
      originalMessage: runtimeError.originalMessage,
    }),
  );

  assert.equal(error.code, "MESSAGE_CHANNEL_ERROR");
  assert.match(error.message, /receiving end does not exist/i);
  assert.match(error.originalMessage, /receiving end does not exist/i);
});

test("DocsRuntime.getURL devuelve null cuando el contexto de la extension fue invalidado", () => {
  const { exports } = createSandbox({
    getURL() {
      throw new Error("Extension context invalidated.");
    },
  });

  const resolvedUrl = exports.DocsRuntime.getURL("assets/icons/logo.svg");

  assert.equal(resolvedUrl, null);
});
