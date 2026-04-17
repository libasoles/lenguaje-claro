const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const patcherSource = fs.readFileSync(
  path.join(projectRoot, "content", "canvas-patcher.js"),
  "utf8",
);

function createEventTarget() {
  const listeners = new Map();

  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      event.target = this;
      const handlers = Array.from(listeners.get(event.type) || []);
      handlers.forEach((handler) => handler.call(this, event));
      return true;
    },
  };
}

function loadCanvasPatcher() {
  let now = 0;
  let timerId = 1;
  const timers = new Map();

  function runDueTimers() {
    let ran = true;

    while (ran) {
      ran = false;
      const dueTimers = Array.from(timers.entries())
        .filter(([, timer]) => timer.runAt <= now)
        .sort((a, b) => a[1].runAt - b[1].runAt || a[0] - b[0]);

      dueTimers.forEach(([id, timer]) => {
        if (!timers.has(id)) return;
        timers.delete(id);
        timer.callback();
        ran = true;
      });
    }
  }

  function CanvasRenderingContext2D() {
    this.canvas = null;
    this.font = "16px sans-serif";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
    this.direction = "ltr";
  }

  CanvasRenderingContext2D.prototype.clearRect = function () {};
  CanvasRenderingContext2D.prototype.fillText = function () {};
  CanvasRenderingContext2D.prototype.getTransform = function () {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  };

  function Event(type) {
    this.type = type;
  }

  function CustomEvent(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }

  const document = createEventTarget();

  const sandbox = {
    console,
    Map,
    Date,
    Event,
    CustomEvent,
    document,
    performance: {
      now() {
        return now;
      },
    },
    setTimeout(callback, delay = 0) {
      const id = timerId++;
      timers.set(id, { callback, runAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    CanvasRenderingContext2D,
  };

  vm.createContext(sandbox);
  vm.runInContext(patcherSource, sandbox, {
    filename: "content/canvas-patcher.js",
  });

  return {
    CanvasRenderingContext2D,
    document,
    setNow(value) {
      now = value;
      runDueTimers();
    },
  };
}

test("descarta fragmentos viejos cuando una nueva rafaga de render reemplaza el canvas", async () => {
  const { CanvasRenderingContext2D, document, setNow } = loadCanvasPatcher();

  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 400 };
    },
  };

  const ctx = new CanvasRenderingContext2D();
  ctx.canvas = canvas;

  const request = () =>
    new Promise((resolve) => {
      const handler = (event) => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        resolve(event.detail || []);
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("fue dictada por este Tribunal", 100, 100);
  const firstSnapshot = await request();

  setNow(100);
  ctx.fillText("fue dictada por este Tribunal", 320, 220);
  const secondSnapshot = await request();

  assert.equal(firstSnapshot.length, 1);
  assert.equal(firstSnapshot[0].fragments.length, 1);
  assert.equal(firstSnapshot[0].fragments[0].x, 100);

  assert.equal(secondSnapshot.length, 1);
  assert.equal(secondSnapshot[0].fragments.length, 1);
  assert.equal(secondSnapshot[0].fragments[0].x, 320);
});

test("emite un evento cuando termina una rafaga de render en canvas", () => {
  const { CanvasRenderingContext2D, document, setNow } = loadCanvasPatcher();

  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 400 };
    },
  };

  const ctx = new CanvasRenderingContext2D();
  ctx.canvas = canvas;

  const renderEvents = [];
  document.addEventListener("docs-reviewer-canvas-rendered", (event) => {
    renderEvents.push(event.detail?.renderedAt);
  });

  setNow(0);
  ctx.fillText("Primera línea", 100, 100);
  ctx.fillText("Segunda línea", 100, 120);

  assert.equal(renderEvents.length, 0);

  setNow(39);
  assert.equal(renderEvents.length, 0);

  setNow(40);
  assert.equal(renderEvents.length, 1);
  assert.equal(renderEvents[0], 40);
});
