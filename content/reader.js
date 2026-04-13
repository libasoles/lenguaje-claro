// reader.js - Extrae texto del documento vía la Google Docs API (a través del background)
// Google Docs migró a canvas-based rendering, por lo que el DOM ya no contiene el texto.

const DocsReader = {
  lastReadError: null,

  // Obtiene el ID del documento desde la URL actual
  getDocumentId() {
    const match = window.location.href.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // Obtiene el texto completo contactando al background service worker,
  // que a su vez llama a la Google Docs API con OAuth.
  leerDocumento(options = {}) {
    const docId = this.getDocumentId();
    if (!docId) return Promise.resolve(null);

    this.lastReadError = null;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "GET_DOC_TEXT",
          docId,
          interactive: Boolean(options.interactive),
        },
        (response) => {
          if (chrome.runtime.lastError) {
            this.lastReadError = {
              code: "MESSAGE_CHANNEL_ERROR",
              message: chrome.runtime.lastError.message,
            };
            console.error(
              "[Legal Docs] Error de comunicación con background:",
              chrome.runtime.lastError.message,
            );
            resolve(null);
            return;
          }
          if (response?.error) {
            this.lastReadError = {
              code: response.errorCode || "BACKGROUND_ERROR",
              message: response.error,
            };
            console.error("[Legal Docs] Error de API:", response.error);
            resolve(null);
            return;
          }
          if (!response?.text) {
            resolve(null);
            return;
          }

          resolve({
            text: response.text,
            segments: Array.isArray(response.segments) ? response.segments : [],
          });
        },
      );
    });
  },

  leerTextoCompleto(options = {}) {
    return this.leerDocumento(options).then((documento) => documento?.text || null);
  },

  // Verifica que la URL sea la de un documento válido
  esperarDocumentoListo() {
    return Promise.resolve(!!this.getDocumentId());
  },
};
