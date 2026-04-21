// docs-editor.js - Isolated world.
// Coordina con kix-bridge.js (main world) para aplicar reemplazos undoables
// en Google Docs replicando la receta de Grammarly:
//
//   1. Escribir `chrome.runtime.id` en `document.documentElement.dataset.orchestratorExtId`
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
    throw new Error(
      "No se pudo acceder al contentDocument del iframe de eventos",
    );
  }
  const editable = doc.querySelector('[contenteditable="true"]');
  if (!editable) {
    throw new Error(
      'No se encontró [contenteditable="true"] dentro del iframe',
    );
  }
  return editable;
}

function enfocarContextoEdicion(editable) {
  const iframeWindow = editable?.ownerDocument?.defaultView || null;

  try {
    iframeWindow?.focus?.();
  } catch (_) {
    // Algunos entornos de prueba no exponen focus sobre el window del iframe.
  }

  if (typeof editable?.focus !== "function") return;

  try {
    editable.focus({ preventScroll: true });
  } catch (_) {
    editable.focus();
  }
}

function normalizarTextoExacto(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function construirModeloTextoNormalizado(text) {
  const normalizedChars = [];
  const charRanges = [];
  let previousWasWhitespace = false;

  for (let index = 0; index < (text || "").length; index += 1) {
    const char = text[index];

    if (/\s/.test(char)) {
      if (!previousWasWhitespace) {
        normalizedChars.push(" ");
        charRanges.push({ rawStart: index, rawEnd: index + 1 });
        previousWasWhitespace = true;
      } else if (charRanges.length > 0) {
        charRanges[charRanges.length - 1].rawEnd = index + 1;
      }
      continue;
    }

    normalizedChars.push(char);
    charRanges.push({ rawStart: index, rawEnd: index + 1 });
    previousWasWhitespace = false;
  }

  while (normalizedChars[0] === " ") {
    normalizedChars.shift();
    charRanges.shift();
  }
  while (normalizedChars.at(-1) === " ") {
    normalizedChars.pop();
    charRanges.pop();
  }

  const normalizedText = normalizedChars.join("");
  return {
    normalizedText,
    normalizedLower: normalizedText.toLocaleLowerCase(),
    charRanges,
  };
}

function encontrarRangosTexto(haystack, needle) {
  if (!haystack || !needle || needle.length > haystack.length) return [];

  const matches = [];
  const limit = haystack.length - needle.length;

  for (let start = 0; start <= limit; start += 1) {
    if (!haystack.startsWith(needle, start)) continue;
    matches.push({
      start,
      end: start + needle.length,
    });
  }

  return matches;
}

function mapearRangoNormalizadoARaw(charRanges, start, end) {
  if (
    !Array.isArray(charRanges) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    return null;
  }

  const firstChar = charRanges[start];
  const lastChar = charRanges[end - 1];

  if (!firstChar || !lastChar) return null;

  return {
    start: firstChar.rawStart,
    end: lastChar.rawEnd,
  };
}

function encontrarCoincidenciaPorInicio(candidates, preferredStart) {
  if (!Array.isArray(candidates) || !Number.isInteger(preferredStart)) {
    return null;
  }

  for (const candidate of candidates) {
    if (candidate.start === preferredStart) {
      return candidate;
    }
  }

  return null;
}

function encontrarRangoCercanoExacto(
  text,
  needle,
  preferredStart,
  maxDistance = 30,
) {
  if (!needle || !Number.isInteger(preferredStart)) return null;

  const nearbyCandidates = [];

  for (const candidate of encontrarRangosTexto(text, needle)) {
    if (Math.abs(candidate.start - preferredStart) <= maxDistance) {
      nearbyCandidates.push(candidate);
    }
  }

  const exactMatch = encontrarCoincidenciaPorInicio(
    nearbyCandidates,
    preferredStart,
  );
  if (exactMatch) return exactMatch;

  return nearbyCandidates.length === 1 ? nearbyCandidates[0] : null;
}

function seleccionarCandidatoSeguro(candidates, preferredStart, ordinal) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  if (
    Number.isInteger(ordinal) &&
    ordinal >= 0 &&
    ordinal < candidates.length
  ) {
    return candidates[ordinal];
  }

  const exactMatch = encontrarCoincidenciaPorInicio(candidates, preferredStart);
  if (exactMatch) return exactMatch;

  return candidates.length === 1 ? candidates[0] : null;
}

function resolverRangoContraTextoActual({
  text,
  inicio,
  fin,
  textoOriginal,
  normalizedStart,
  normalizedEnd,
  ordinalExacto,
  ordinalMinusculas,
} = {}) {
  if (typeof text !== "string" || typeof textoOriginal !== "string") {
    return null;
  }

  if (
    Number.isInteger(inicio) &&
    Number.isInteger(fin) &&
    fin > inicio &&
    text.slice(inicio, fin) === textoOriginal
  ) {
    return { start: inicio, end: fin };
  }

  const nearbyExactMatch = encontrarRangoCercanoExacto(
    text,
    textoOriginal,
    inicio,
  );
  if (nearbyExactMatch) {
    return nearbyExactMatch;
  }

  const normalizedNeedle = normalizarTextoExacto(textoOriginal);
  if (!normalizedNeedle) return null;

  const normalizedModel = construirModeloTextoNormalizado(text);

  if (
    Number.isInteger(normalizedStart) &&
    Number.isInteger(normalizedEnd) &&
    normalizedEnd > normalizedStart &&
    normalizedModel.normalizedText.slice(normalizedStart, normalizedEnd) ===
      normalizedNeedle
  ) {
    const exactNormalizedRange = mapearRangoNormalizadoARaw(
      normalizedModel.charRanges,
      normalizedStart,
      normalizedEnd,
    );
    if (exactNormalizedRange) return exactNormalizedRange;
  }

  const exactCandidates = encontrarRangosTexto(
    normalizedModel.normalizedText,
    normalizedNeedle,
  );
  const exactCandidate = seleccionarCandidatoSeguro(
    exactCandidates,
    normalizedStart,
    ordinalExacto,
  );
  if (exactCandidate) {
    return mapearRangoNormalizadoARaw(
      normalizedModel.charRanges,
      exactCandidate.start,
      exactCandidate.end,
    );
  }

  const lowerNeedle = normalizedNeedle.toLocaleLowerCase();
  const lowerCandidates = encontrarRangosTexto(
    normalizedModel.normalizedLower,
    lowerNeedle,
  );
  const lowerCandidate = seleccionarCandidatoSeguro(
    lowerCandidates,
    normalizedStart,
    ordinalMinusculas,
  );
  if (lowerCandidate) {
    return mapearRangoNormalizadoARaw(
      normalizedModel.charRanges,
      lowerCandidate.start,
      lowerCandidate.end,
    );
  }

  const rawCandidates = encontrarRangosTexto(text, textoOriginal);
  return rawCandidates.length === 1 ? rawCandidates[0] : null;
}

export const DocsEditor = {
  inicializar() {
    const extensionId = obtenerExtensionId();
    if (extensionId && document.documentElement) {
      document.documentElement.dataset.orchestratorExtId = extensionId;
    } else {
      console.warn(
        `[LenguajeClaro] no se pudo escribir extensionId en documentElement.dataset`,
      );
    }
  },

  async pedirAccesorTexto() {
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

  async establecerSeleccion(inicio, fin) {
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
      throw new Error(response.error || "establecerSeleccion falló");
    }
    return response;
  },

  async aplicarReemplazo({
    inicio,
    fin,
    textoOriginal,
    textoReemplazo,
    normalizedStart = null,
    normalizedEnd = null,
    ordinalExacto = null,
    ordinalMinusculas = null,
  } = {}) {
    if (!Number.isInteger(inicio) || !Number.isInteger(fin) || fin <= inicio) {
      throw new Error(`Rango inválido: inicio=${inicio}, fin=${fin}`);
    }
    if (typeof textoReemplazo !== "string") {
      throw new Error("textoReemplazo debe ser un string");
    }

    // Use accessor text (Kix internal model) to find the exact position,
    // since REST API positions can be off by a few chars from Kix model positions.
    let inicioKix = inicio;
    let finKix = fin;

    if (typeof textoOriginal === "string") {
      let textoAccesor = null;
      try {
        textoAccesor = await this.pedirAccesorTexto();
      } catch (e) {
        console.warn(
          `[LenguajeClaro] no se pudo obtener texto del accessor:`,
          e,
        );
      }

      if (textoAccesor) {
        const resolvedRange = resolverRangoContraTextoActual({
          text: textoAccesor,
          inicio,
          fin,
          textoOriginal,
          normalizedStart,
          normalizedEnd,
          ordinalExacto,
          ordinalMinusculas,
        });

        if (!resolvedRange) {
          throw new Error(
            `No se pudo ubicar "${textoOriginal}" de forma segura en el documento actual. Reanalizá el documento antes de aplicar.`,
          );
        }

        inicioKix = resolvedRange.start;
        finKix = resolvedRange.end;
      } else {
        // Fallback: validate with REST API text and apply ±1 adjustment
        const textoDoc = await DocsReader.leerTextoCompleto();
        if (typeof textoDoc !== "string") {
          throw new Error(
            "No se pudo leer el documento para validar el reemplazo",
          );
        }

        const resolvedRange = resolverRangoContraTextoActual({
          text: textoDoc,
          inicio,
          fin,
          textoOriginal,
          normalizedStart,
          normalizedEnd,
          ordinalExacto,
          ordinalMinusculas,
        });

        if (resolvedRange) {
          inicioKix = resolvedRange.start;
          finKix = resolvedRange.end;
        } else {
          let fragmento = textoDoc.slice(inicio, fin);
          if (textoDoc.slice(inicio - 1, fin - 1) === textoOriginal) {
            inicioKix = inicio - 1;
            finKix = fin - 1;
          } else if (textoDoc.slice(inicio + 1, fin + 1) === textoOriginal) {
            inicioKix = inicio + 1;
            finKix = fin + 1;
          } else {
            throw new Error(
              `El texto en [${inicio}, ${fin}] cambió. Esperaba "${textoOriginal}" pero encontré "${fragmento}".`,
            );
          }
        }
      }
    }

    const editable = obtenerContenteditableDelIframe();
    enfocarContextoEdicion(editable);
    await this.establecerSeleccion(inicioKix, finKix);
    enfocarContextoEdicion(editable);
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

    return { ok: true, notPrevented };
  },
};

DocsEditor.inicializar();

if (typeof window !== "undefined") {
  window.DocsEditor = DocsEditor;
}

export default DocsEditor;
