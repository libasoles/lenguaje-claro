// background.js - Service worker: gestiona OAuth y llamadas a la Google Docs API
//
// NOTA DE CONFIGURACIÓN: Para que chrome.identity.getAuthToken funcione en desarrollo,
// debes añadir el ID de esta extensión (visible en chrome://extensions) como
// "Authorized redirect URI" en Google Cloud Console bajo tu OAuth client ID.
// Formato: https://<extension-id>.chromiumapp.org/

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const respond = async (handler) => {
    try {
      const result = await handler();
      sendResponse(result);
    } catch (err) {
      console.error("[Docs Reviewer] Error en background:", err);
      sendResponse(normalizeError(err));
    }
  };

  if (request.type === "GET_DOC_TEXT") {
    respond(() =>
      handleGetDocText(request.docId, {
        interactive: Boolean(request.interactive),
      }),
    );
    return true; // Mantener el canal abierto para respuesta async
  }

  if (request.type === "APPLY_REPLACEMENT") {
    respond(() =>
      handleApplyReplacement(
        request.docId,
        request.original,
        request.replacement,
        request.range,
      ),
    );
    return true;
  }
});

function createError(message, code = "UNKNOWN") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeError(error) {
  return {
    error: error?.message || "Error desconocido",
    errorCode: error?.code || "UNKNOWN",
  };
}

async function getAuthToken({ interactive = false } = {}) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === "string" ? result : result?.token;

    if (!token) {
      throw createError(
        "No se recibió un token de autenticación válido.",
        "AUTH_NO_TOKEN",
      );
    }

    return token;
  } catch (error) {
    if (!interactive) {
      throw createError(
        "Se requiere autorización de Google antes de analizar el documento.",
        "AUTH_REQUIRED",
      );
    }

    throw createError(
      error?.message || "No se pudo obtener el token de Google.",
      "AUTH_FAILED",
    );
  }
}

async function removeCachedAuthToken(token) {
  if (!token) return;

  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch (error) {
    console.warn(
      "[Docs Reviewer] No se pudo limpiar el token en caché:",
      error,
    );
  }
}

async function fetchGoogleDoc(docId, token) {
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (response.status === 401) {
    throw createError("El token de Google expiró o ya no es válido.", "AUTH_EXPIRED");
  }

  if (!response.ok) {
    const body = await response.text();
    throw createError(
      `Docs API error ${response.status}: ${body}`,
      "DOCS_API_ERROR",
    );
  }

  return response.json();
}

async function handleGetDocText(docId, options = {}) {
  if (!docId) {
    throw createError("No se recibió el ID del documento.", "INVALID_DOC_ID");
  }

  const interactive = Boolean(options.interactive);
  let token = await getAuthToken({ interactive });
  let doc;

  try {
    doc = await fetchGoogleDoc(docId, token);
  } catch (error) {
    if (error.code !== "AUTH_EXPIRED") {
      throw error;
    }

    await removeCachedAuthToken(token);
    token = await getAuthToken({ interactive });
    doc = await fetchGoogleDoc(docId, token);
  }

  const { text, segments } = extractTextWithSegments(doc);

  return { text, segments };
}

async function handleApplyReplacement(
  docId,
  originalText,
  replacementText,
  range,
) {
  const token = await getAuthToken({ interactive: true });
  const requests =
    range &&
    Number.isInteger(range.startIndex) &&
    Number.isInteger(range.endIndex)
      ? [
          {
            deleteContentRange: {
              range: {
                startIndex: range.startIndex,
                endIndex: range.endIndex,
              },
            },
          },
          {
            insertText: {
              location: { index: range.startIndex },
              text: replacementText,
            },
          },
        ]
      : [
          {
            replaceAllText: {
              containsText: {
                text: originalText,
                matchCase: true,
              },
              replaceText: replacementText,
            },
          },
        ];

  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw createError(
      `Docs API error ${response.status}: ${body}`,
      "DOCS_API_ERROR",
    );
  }

  return { success: true };
}

// Extrae el texto del documento y construye un mapa de posiciones entre
// el string resultado y los índices de la Docs API (usados para batchUpdate).
function extractTextWithSegments(doc) {
  const segments = [];
  let text = "";

  for (const element of doc.body?.content || []) {
    if (element.paragraph) {
      let paraText = "";
      for (const pe of element.paragraph.elements) {
        if (pe.textRun?.content) {
          segments.push({
            apiStart: pe.startIndex, // índice en la API (1-based)
            apiEnd: pe.endIndex,
            strStart: text.length, // posición en nuestro string (0-based)
            length: pe.textRun.content.length,
          });
          paraText += pe.textRun.content;
        }
      }
      text += paraText;
    }
  }

  return { text, segments };
}
