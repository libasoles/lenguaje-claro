// runtime.js - Helpers seguros para acceder a chrome.runtime desde content scripts.

const DocsRuntime = (window.DocsRuntime = {
  INVALIDATED_CONTEXT_MESSAGE:
    "La extensión se actualizó. Recargá la página para continuar.",

  isContextInvalidated(errorOrMessage) {
    const message =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : errorOrMessage?.message || errorOrMessage?.originalMessage || "";

    return /extension context invalidated/i.test(message);
  },

  normalizeError(errorOrMessage) {
    const originalMessage =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : errorOrMessage?.message || "";
    const isInvalidated = this.isContextInvalidated(originalMessage);
    const message = isInvalidated
      ? this.INVALIDATED_CONTEXT_MESSAGE
      : originalMessage || "No se pudo comunicar con la extensión.";
    const error = new Error(message);

    error.code = isInvalidated
      ? "EXTENSION_CONTEXT_INVALIDATED"
      : "MESSAGE_CHANNEL_ERROR";
    error.originalMessage = originalMessage || message;

    return error;
  },

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastErrorMessage = chrome.runtime?.lastError?.message;

          if (lastErrorMessage) {
            reject(this.normalizeError(lastErrorMessage));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(this.normalizeError(error));
      }
    });
  },

  getURL(resourcePath) {
    try {
      return chrome.runtime.getURL(resourcePath);
    } catch (error) {
      const normalizedError = this.normalizeError(error);

      console.error(
        "[Legal Docs] Error al resolver recurso de la extensión:",
        normalizedError.originalMessage,
      );

      return null;
    }
  },
});
