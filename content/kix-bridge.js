// Runs in MAIN world at document_start.
// Puente con la API oficial de anotaciones de Google Docs.
//
// Flujo:
//   1. Esperar a que exista `window._docs_annotate_getAnnotatedText` Y que el
//      isolated world haya escrito `document.documentElement.dataset.orchestratorExtId`.
//   2. Invocar `_docs_annotate_getAnnotatedText(extensionId)` y guardar el
//      accessor resultante (`{getText, getAnnotations, getSelection, setSelection}`)
//      en `window.__orchestratorAccessor`.
//   3. Exponer los métodos del accessor al isolated world vía CustomEvents:
//        - docs-reviewer-get-text       -> docs-reviewer-text-result
//        - docs-reviewer-set-selection  -> docs-reviewer-selection-result
//
// La aplicación del reemplazo (InputEvent "beforeinput") ocurre en el isolated
// world sobre el `[contenteditable]` dentro de `iframe.docs-texteventtarget-iframe`,
// que es same-origin y accesible sin necesidad de main world.

(function () {
  "use strict";

  const POLL_INTERVAL_MS = 100;

  let accessor = null;
  let isAcquiring = false;
  let pollTimer = null;

  function getExtensionId() {
    try {
      return document.documentElement?.dataset?.orchestratorExtId || null;
    } catch (_) {
      return null;
    }
  }

  function tryAcquireAccessor() {
    if (accessor || isAcquiring) return;

    const getAnnotatedText = window._docs_annotate_getAnnotatedText;
    const extensionId = getExtensionId();

    if (typeof getAnnotatedText !== "function" || !extensionId) return;

    isAcquiring = true;

    Promise.resolve()
      .then(() => getAnnotatedText(extensionId))
      .then((result) => {
        isAcquiring = false;
        if (!result) return;
        if (accessor) return;

        accessor = result;
        window.__orchestratorAccessor = accessor;

        document.dispatchEvent(new CustomEvent("docs-reviewer-accessor-ready"));
      })
      .catch(() => {
        isAcquiring = false;
      });
  }

  function iniciarSondeo() {
    if (pollTimer) return;

    pollTimer = setInterval(() => {
      if (accessor) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }

      tryAcquireAccessor();
    }, POLL_INTERVAL_MS);
  }

  function getEventIframeEditable() {
    try {
      const iframe = document.querySelector(
        "iframe.docs-texteventtarget-iframe",
      );
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      return doc.querySelector('[contenteditable="true"]') || doc.body || null;
    } catch (_) {
      return null;
    }
  }

  function wakeUpSelectionSystem() {
    const target = getEventIframeEditable();
    if (!target) return false;
    try {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function selectionMatches(start, end) {
    if (typeof accessor?.getSelection !== "function") return false;
    try {
      const sel = accessor.getSelection();
      if (!sel) return false;
      const ranges = Array.isArray(sel) ? sel : [sel];
      return ranges.some(
        (range) =>
          range && Number(range.start) === start && Number(range.end) === end,
      );
    } catch (_) {
      return false;
    }
  }

  async function setSelectionWithFallback(start, end) {
    if (!accessor || typeof accessor.setSelection !== "function") {
      return { ok: false, error: "accessor-not-ready" };
    }

    try {
      await accessor.setSelection(start, end);
      if (!selectionMatches(start, end)) {
        wakeUpSelectionSystem();
        await accessor.setSelection(start, end);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function respond(eventName, detail) {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  document.addEventListener("docs-reviewer-set-selection", (event) => {
    const detail = event.detail || {};
    const requestId = detail.requestId || null;
    const start = Number(detail.start);
    const end = Number(detail.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      respond("docs-reviewer-selection-result", {
        ok: false,
        error: "invalid-range",
        requestId,
      });
      return;
    }

    setSelectionWithFallback(start, end).then((result) => {
      respond("docs-reviewer-selection-result", { ...result, requestId });
    });
  });

  document.addEventListener("docs-reviewer-get-text", (event) => {
    const requestId = event.detail?.requestId || null;

    if (!accessor || typeof accessor.getText !== "function") {
      respond("docs-reviewer-text-result", {
        ok: false,
        error: "accessor-not-ready",
        requestId,
      });
      return;
    }

    try {
      const raw = accessor.getText();
      const fullText = typeof raw === "string" ? raw : raw?.fullText || "";
      respond("docs-reviewer-text-result", {
        ok: true,
        fullText,
        requestId,
      });
    } catch (error) {
      respond("docs-reviewer-text-result", {
        ok: false,
        error: String(error?.message || error),
        requestId,
      });
    }
  });

  iniciarSondeo();
})();
