const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const interceptorsSource = fs.readFileSync(
  path.join(projectRoot, "content", "canvas-interceptors.js"),
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

function loadCanvasInterceptors() {
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
  const window = createEventTarget();
  window.postMessage = function (data) {
    this.dispatchEvent({
      type: "message",
      source: window,
      data,
    });
  };

  const sandbox = {
    console,
    Map,
    Date,
    Event,
    CustomEvent,
    document,
    window,
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
  vm.runInContext(interceptorsSource, sandbox, {
    filename: "content/canvas-interceptors.js",
  });

  return {
    CanvasRenderingContext2D,
    document,
    window,
    setNow(value) {
      now = value;
      runDueTimers();
    },
  };
}

function extraerRespuestaFragmentos(detail) {
  if (Array.isArray(detail)) {
    return {
      canvasResults: detail,
      source: "legacy",
    };
  }

  return {
    canvasResults: Array.isArray(detail?.canvasResults)
      ? detail.canvasResults
      : [],
    source: detail?.source || "unknown",
  };
}

test("descarta fragmentos viejos cuando una nueva rafaga de render reemplaza el canvas", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("fue dictada por este Tribunal", 100, 100);
  const firstSnapshot = await request();

  // Dentro de un mismo ciclo de render (líneas consecutivas de un párrafo
  // pueden emitirse con 100+ ms entre medias) ambos fragments deben
  // sobrevivir: borrar el primero rompe el resaltado de issues multilínea.
  setNow(100);
  ctx.fillText("fue dictada por este Tribunal", 320, 220);
  const secondSnapshot = await request();

  // Una ráfaga muy posterior sí representa un ciclo distinto y debe
  // descartar los fragments previos para evitar posiciones stale.
  setNow(1000);
  ctx.fillText("fue dictada por este Tribunal", 540, 340);
  const thirdSnapshot = await request();

  assert.equal(firstSnapshot.source, "live");
  assert.equal(firstSnapshot.canvasResults.length, 1);
  assert.equal(firstSnapshot.canvasResults[0].fragments.length, 1);
  assert.equal(firstSnapshot.canvasResults[0].fragments[0].x, 100);

  assert.equal(secondSnapshot.source, "live");
  assert.equal(secondSnapshot.canvasResults.length, 1);
  assert.equal(secondSnapshot.canvasResults[0].fragments.length, 2);
  assert.equal(secondSnapshot.canvasResults[0].fragments[0].x, 100);
  assert.equal(secondSnapshot.canvasResults[0].fragments[1].x, 320);

  assert.equal(thirdSnapshot.source, "live");
  assert.equal(thirdSnapshot.canvasResults.length, 1);
  assert.equal(thirdSnapshot.canvasResults[0].fragments.length, 1);
  assert.equal(thirdSnapshot.canvasResults[0].fragments[0].x, 540);
});

test("reemplaza un fragment previo cuando se redibuja en la misma posición", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("viejo", 100, 100);
  setNow(50);
  ctx.fillText("nuevo", 100, 100);
  const snapshot = await request();

  assert.equal(snapshot.canvasResults[0].fragments.length, 1);
  assert.equal(snapshot.canvasResults[0].fragments[0].text, "nuevo");
});

test("no reemplaza fragments si cambia la transformación aunque x e y coincidan", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  ctx.getTransform = function () {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  };
  setNow(0);
  ctx.fillText("primero", 100, 100);

  ctx.getTransform = function () {
    return { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };
  };
  setNow(50);
  ctx.fillText("segundo", 100, 100);
  const snapshot = await request();

  assert.equal(snapshot.canvasResults[0].fragments.length, 2);
  const fragmentTexts = Array.from(
    snapshot.canvasResults[0].fragments,
    (fragment) => fragment.text,
  );
  assert.deepEqual(fragmentTexts, ["primero", "segundo"]);
});

test("descarta fragments previos cuando hay scroll antes del siguiente render", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("texto anterior", 100, 100);

  document.dispatchEvent({ type: "docs-reviewer-viewport-scrolled" });
  setNow(100);
  ctx.fillText("texto nuevo", 320, 220);
  const snapshot = await request();

  assert.equal(snapshot.source, "live");
  assert.equal(snapshot.canvasResults.length, 1);
  assert.equal(snapshot.canvasResults[0].fragments.length, 1);
  assert.equal(snapshot.canvasResults[0].fragments[0].text, "texto nuevo");
});

test("emite un evento cuando termina una rafaga de render en canvas", () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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

test("omite snapshot fallback cuando el request lo deshabilita", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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

  const request = (detail) =>
    new Promise((resolve) => {
      const handler = (event) => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({
        type: "docs-reviewer-request-fragments",
        detail,
      });
    });

  setNow(0);
  ctx.fillText("Texto visible", 100, 100);

  setNow(40);
  canvas.isConnected = false;

  const withoutFallback = await request({ allowSnapshotFallback: false });
  assert.equal(withoutFallback.source, "empty");
  assert.equal(withoutFallback.canvasResults.length, 0);

  const withFallback = await request({ allowSnapshotFallback: true });
  assert.equal(withFallback.source, "snapshot");
  assert.equal(withFallback.canvasResults.length, 1);
});

test("invalida snapshot fallback cuando cambia el viewport por scroll", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("Texto visible", 100, 100);
  setNow(40);
  canvas.isConnected = false;

  const beforeScroll = await request();
  document.dispatchEvent({ type: "docs-reviewer-viewport-scrolled" });
  const afterScroll = await request();

  assert.equal(beforeScroll.source, "snapshot");
  assert.equal(beforeScroll.canvasResults.length, 1);
  assert.equal(afterScroll.source, "empty");
  assert.equal(afterScroll.canvasResults.length, 0);
});

test("incluye la posicion del tile parent en el payload de fragments", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    parentElement: {
      style: {
        top: "120px",
        left: "36px",
      },
      getBoundingClientRect() {
        return { left: 36, top: 120, width: 800, height: 400 };
      },
    },
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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("Texto visible", 100, 100);
  const snapshot = await request();

  assert.equal(snapshot.canvasResults[0].tilePosition.top, "120px");
  assert.equal(snapshot.canvasResults[0].tilePosition.left, "36px");
  assert.equal(snapshot.canvasResults[0].tilePosition.topPx, 120);
  assert.equal(snapshot.canvasResults[0].tilePosition.leftPx, 36);
  assert.equal(snapshot.canvasResults[0].tilePosition.viewportRect.top, 120);
});

test("descarta fragments si el tile parent se recicla con transform distinto", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

  const parentElement = {
    style: {
      top: "120px",
      left: "36px",
      transform: "translateY(0px)",
    },
    getBoundingClientRect() {
      return { left: 36, top: 120, width: 800, height: 400 };
    },
  };
  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    parentElement,
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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("Texto viejo", 100, 100);
  parentElement.style.transform = "translateY(400px)";

  const snapshot = await request();

  assert.equal(snapshot.source, "empty");
  assert.equal(snapshot.canvasResults.length, 0);
});

test("invalida snapshot sin borrar fragments live cuando el documento cambia", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    parentElement: {
      style: {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 400 };
      },
    },
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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("Texto anterior", 100, 100);
  setNow(50);
  const before = await request();

  document.dispatchEvent({ type: "docs-reviewer-invalidate-canvas-cache" });
  const liveAfterInvalidation = await request();
  canvas.isConnected = false;
  const fallbackAfterInvalidation = await request();

  assert.equal(before.source, "live");
  assert.equal(before.canvasResults.length, 1);
  assert.equal(liveAfterInvalidation.source, "live");
  assert.equal(liveAfterInvalidation.canvasResults.length, 1);
  assert.equal(fallbackAfterInvalidation.source, "empty");
  assert.equal(fallbackAfterInvalidation.canvasResults.length, 0);
});

test("invalida fragments live solo cuando se pide limpieza explícita", async () => {
  const { CanvasRenderingContext2D, document, setNow } =
    loadCanvasInterceptors();

  const canvas = {
    width: 800,
    height: 400,
    isConnected: true,
    parentElement: {
      style: {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 400 };
      },
    },
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
        resolve(extraerRespuestaFragmentos(event.detail));
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent({ type: "docs-reviewer-request-fragments" });
    });

  setNow(0);
  ctx.fillText("Texto anterior", 100, 100);
  setNow(50);
  const before = await request();

  document.dispatchEvent({
    type: "docs-reviewer-invalidate-canvas-cache",
    detail: { clearLiveCanvas: true },
  });
  const after = await request();

  assert.equal(before.source, "live");
  assert.equal(before.canvasResults.length, 1);
  assert.equal(after.source, "empty");
  assert.equal(after.canvasResults.length, 0);
});
