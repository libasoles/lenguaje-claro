const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const runtimeSource = fs.readFileSync(
  path.join(projectRoot, "content", "runtime.js"),
  "utf8",
);
const readerSource = fs.readFileSync(
  path.join(projectRoot, "content", "reader.js"),
  "utf8",
);

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

  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox, { filename: "content/runtime.js" });
  vm.runInContext(readerSource, sandbox, { filename: "content/reader.js" });

  return sandbox;
}

test("DocsReader normaliza el contexto invalidado cuando sendMessage falla sincronicamente", async () => {
  const sandbox = createSandbox({
    sendMessage() {
      throw new Error("Extension context invalidated.");
    },
  });

  const result = await vm.runInContext("DocsReader.leerDocumento()", sandbox);
  const lastReadError = vm.runInContext("DocsReader.lastReadError", sandbox);

  assert.equal(result, null);
  assert.equal(lastReadError.code, "EXTENSION_CONTEXT_INVALIDATED");
  assert.match(lastReadError.message, /recargá esta pestaña/i);
});

test("DocsRuntime normaliza lastError del callback sin dejar rechazo no manejado", async () => {
  const sandbox = createSandbox({
    sendMessage(_message, callback) {
      this.lastError = {
        message:
          "Could not establish connection. Receiving end does not exist.",
      };
      callback();
      this.lastError = null;
    },
  });

  const error = await vm.runInContext(
    `DocsRuntime.sendMessage({ type: "PING" }).catch((runtimeError) => ({
      code: runtimeError.code,
      message: runtimeError.message,
      originalMessage: runtimeError.originalMessage,
    }))`,
    sandbox,
  );

  assert.equal(error.code, "MESSAGE_CHANNEL_ERROR");
  assert.match(error.message, /receiving end does not exist/i);
  assert.match(error.originalMessage, /receiving end does not exist/i);
});

test("DocsRuntime.getURL devuelve null cuando el contexto de la extension fue invalidado", () => {
  const sandbox = createSandbox({
    getURL() {
      throw new Error("Extension context invalidated.");
    },
  });

  const resolvedUrl = vm.runInContext(
    `DocsRuntime.getURL("assets/icons/logo.svg")`,
    sandbox,
  );

  assert.equal(resolvedUrl, null);
});
