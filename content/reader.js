// reader.js - Extrae texto del documento vía la Google Docs API (a través del background)
// Google Docs migró a canvas-based rendering, por lo que el DOM ya no contiene el texto.

import { DocsRuntime } from "./runtime.js";

export const DocsReader = {
  lastReadError: null,

  // Obtiene el ID del documento desde la URL actual
  getDocumentId() {
    const match = window.location.href.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // Obtiene el texto completo contactando al background service worker,
  // que a su vez llama a la Google Docs API con OAuth.
  async leerDocumento(options = {}) {
    const docId = this.getDocumentId();
    if (!docId) return null;

    this.lastReadError = null;

    try {
      const response = await DocsRuntime.sendMessage(
        {
          type: "GET_DOC_TEXT",
          docId,
          interactive: Boolean(options.interactive),
        },
      );

      if (response?.error) {
        this.lastReadError = {
          code: response.errorCode || "BACKGROUND_ERROR",
          message: response.error,
        };
        console.error("[Legal Docs] Error de API:", response.error);
        return null;
      }

      if (!response?.text) {
        return null;
      }

      return {
        text: response.text,
        segments: Array.isArray(response.segments) ? response.segments : [],
      };
    } catch (error) {
      const code = error?.code || "MESSAGE_CHANNEL_ERROR";
      this.lastReadError = {
        code,
        message: error?.message || "No se pudo comunicar con la extensión.",
      };
      const logMessage = error?.originalMessage || error?.message;
      if (code === "EXTENSION_CONTEXT_INVALIDATED") {
        console.warn("[Legal Docs] El contexto de la extensión fue invalidado (recargá la página):", logMessage);
      } else {
        console.error("[Legal Docs] Error de comunicación con background:", logMessage);
      }
      return null;
    }
  },

  leerTextoCompleto(options = {}) {
    return this.leerDocumento(options).then((documento) => documento?.text || null);
  },

  // Verifica que la URL sea la de un documento válido
  esperarDocumentoListo() {
    return Promise.resolve(!!this.getDocumentId());
  },
};

export default DocsReader;
