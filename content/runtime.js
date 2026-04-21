// runtime.js - Helpers seguros para acceder a chrome.runtime desde content scripts.

export const DocsRuntime = {
  INVALIDATED_CONTEXT_MESSAGE:
    "La extensión se actualizó. Recargá la página para continuar.",

  estaContextoInvalidado(errorOrMessage) {
    const message =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : errorOrMessage?.message || errorOrMessage?.originalMessage || "";

    return /extension context invalidated/i.test(message);
  },

  normalizarError(errorOrMessage) {
    const originalMessage =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : errorOrMessage?.message || "";
    const isInvalidated = this.estaContextoInvalidado(originalMessage);
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

  enviarMensaje(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastErrorMessage = chrome.runtime?.lastError?.message;

          if (lastErrorMessage) {
            reject(this.normalizarError(lastErrorMessage));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(this.normalizarError(error));
      }
    });
  },

  obtenerURL(resourcePath) {
    try {
      return chrome.runtime.getURL(resourcePath);
    } catch (error) {
      const errorNormalizado = this.normalizarError(error);

      console.error(
        "[LenguajeClaro] Error al resolver recurso de la extensión:",
        errorNormalizado.originalMessage,
      );

      return null;
    }
  },
};

export default DocsRuntime;
