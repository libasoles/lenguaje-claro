// docs-editor.js - Isolated world.
// Coordina con kix-bridge.js (main world) para aplicar reemplazos undoables
// en Google Docs replicando la receta de Grammarly:
//
//   1. Escribir `chrome.runtime.id` en `document.documentElement.dataset.docsReviewerExtId`
//      lo antes posible: el bridge lo necesita para llamar a
//      `_docs_annotate_getAnnotatedText(extensionId)`.
//   2. Para cada reemplazo:
//        a. Validar contra `DocsReader.leerTextoCompleto()` que `texto[inicio:fin]`
//           coincide con lo esperado (evita aplicar cambios sobre texto distinto).
//        b. Pedir al bridge que posicione la selección vía CustomEvent
//           `docs-reviewer-set-selection`.
//        c. Dispatchar un `InputEvent("beforeinput", {inputType:"insertReplacementText"})`
//           sobre el `[contenteditable]` dentro del `iframe.docs-texteventtarget-iframe`.
//           Ese iframe es same-origin, accesible desde isolated world.
//
// Este flujo hace que Docs procese el cambio por su pipeline de input nativo, lo
// que alimenta el undo stack y permite revertir con ctrl+z.

import { DocsReader } from "./reader.js";

const PREFIX = "[Docs Reviewer][docs-editor]";
const SET_SELECTION_TIMEOUT_MS = 5000;
const GET_TEXT_TIMEOUT_MS = 5000;

function obtenerExtensionId() {
  try {
    return (typeof chrome !== "undefined" && chrome?.runtime?.id) || null;
  } catch (_) {
    return null;
  }
}

function generarRequestId() {
  return `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function esperarRespuesta(eventName, requestId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const detail = event.detail || {};
      if (detail.requestId && detail.requestId !== requestId) return;
      cleanup();
      resolve(detail);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout esperando respuesta de ${eventName}`));
    }, timeoutMs);
    function cleanup() {
      document.removeEventListener(eventName, handler);
      clearTimeout(timer);
    }
    document.addEventListener(eventName, handler);
  });
}

function obtenerContenteditableDelIframe() {
  const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
  if (!iframe) {
    throw new Error("No se encontró iframe.docs-texteventtarget-iframe");
  }
  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error("No se pudo acceder al contentDocument del iframe de eventos");
  }
  const editable = doc.querySelector('[contenteditable="true"]');
  if (!editable) {
    throw new Error('No se encontró [contenteditable="true"] dentro del iframe');
  }
  return editable;
}

export const DocsEditor = {
  init() {
    const extensionId = obtenerExtensionId();
    if (extensionId && document.documentElement) {
      document.documentElement.dataset.docsReviewerExtId = extensionId;
      console.log(`${PREFIX} extensionId expuesto al main world: ${extensionId}`);
    } else {
      console.warn(
        `${PREFIX} no se pudo escribir extensionId en documentElement.dataset`,
      );
    }
  },

  async pedirTextoAccessor() {
    const requestId = generarRequestId();
    const pending = esperarRespuesta(
      "docs-reviewer-text-result",
      requestId,
      GET_TEXT_TIMEOUT_MS,
    );
    document.dispatchEvent(
      new CustomEvent("docs-reviewer-get-text", {
        detail: { requestId },
      }),
    );
    const response = await pending;
    if (!response.ok) {
      throw new Error(response.error || "accessor no disponible");
    }
    return response.fullText || "";
  },

  async setSelection(inicio, fin) {
    const requestId = generarRequestId();
    const pending = esperarRespuesta(
      "docs-reviewer-selection-result",
      requestId,
      SET_SELECTION_TIMEOUT_MS,
    );
    document.dispatchEvent(
      new CustomEvent("docs-reviewer-set-selection", {
        detail: { start: inicio, end: fin, requestId },
      }),
    );
    const response = await pending;
    if (!response.ok) {
      throw new Error(response.error || "setSelection falló");
    }
    return response;
  },

  async aplicarReemplazo({ inicio, fin, textoOriginal, textoReemplazo } = {}) {
    if (!Number.isInteger(inicio) || !Number.isInteger(fin) || fin <= inicio) {
      throw new Error(`Rango inválido: inicio=${inicio}, fin=${fin}`);
    }
    if (typeof textoReemplazo !== "string") {
      throw new Error("textoReemplazo debe ser un string");
    }

    const textoDoc = await DocsReader.leerTextoCompleto();
    if (typeof textoDoc !== "string") {
      throw new Error("No se pudo leer el documento para validar el reemplazo");
    }
    if (fin > textoDoc.length) {
      throw new Error(
        `Rango fuera del documento (fin=${fin}, largo=${textoDoc.length})`,
      );
    }

    const fragmentoActual = textoDoc.slice(inicio, fin);
    if (typeof textoOriginal === "string" && fragmentoActual !== textoOriginal) {
      throw new Error(
        `El texto en [${inicio}, ${fin}] cambió. ` +
          `Esperaba "${textoOriginal}" pero encontré "${fragmentoActual}".`,
      );
    }

    console.log(`${PREFIX} pidiendo setSelection(${inicio}, ${fin})`);
    await this.setSelection(inicio, fin);

    const editable = obtenerContenteditableDelIframe();
    const dt = new DataTransfer();
    dt.setData("text/plain", textoReemplazo);
    const evt = new InputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: textoReemplazo,
      dataTransfer: dt,
      cancelable: true,
      bubbles: true,
    });
    const notPrevented = editable.dispatchEvent(evt);

    console.log(
      `${PREFIX} beforeinput dispatcheado (notPrevented=${notPrevented})`,
      { inicio, fin, textoReemplazo, fragmentoActual },
    );

    return { ok: true, notPrevented };
  },
};

DocsEditor.init();

if (typeof window !== "undefined") {
  window.DocsEditor = DocsEditor;
}

export default DocsEditor;
