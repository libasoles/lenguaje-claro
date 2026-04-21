// content.js - Orquesta el análisis usando la Google Docs API vía background service worker
// y sincroniza panel + overlay inline.

import { rules } from "../rules/index.js";
import { DocsEditor } from "./docs-editor.js";
import { DocsHighlighter } from "./highlighter.jsx";
import { DocsPanel } from "./panel.jsx";
import { DocsReader } from "./reader.js";
import { establecerAccionesReviewer } from "./reviewer-actions.js";
import { DocsRuntime } from "./runtime.js";

const ISSUE_CONTEXT_WINDOW = 24;
const CONTENT_STYLE_PATHS = [
  "content/panel.css",
  "content/highlighter-modules/marker-popup.css",
];

async function estaDeshabilitado(docId) {
  try {
    const { extensionEnabled = true, disabledDocs = [] } =
      await chrome.storage.local.get(["extensionEnabled", "disabledDocs"]);
    if (!extensionEnabled) return true;
    return Array.isArray(disabledDocs) && disabledDocs.includes(docId);
  } catch (error) {
    console.warn("[LenguajeClaro] No se pudo leer storage:", error);
    return false;
  }
}

function obtenerIdExtension() {
  if (typeof chrome === "undefined") return "unknown";
  return chrome.runtime?.id || "unknown";
}

function obtenerStyleElementId(stylePath) {
  const normalizedPath = stylePath.replace(/[^a-z0-9_-]+/gi, "-");
  return `docs-reviewer-style-${obtenerIdExtension()}-${normalizedPath}`;
}

function inyectarEstilosContenido() {
  const target = document.head || document.body;
  if (!target) return;

  CONTENT_STYLE_PATHS.forEach((stylePath) => {
    const elementId = obtenerStyleElementId(stylePath);
    if (document.getElementById(elementId)) return;

    const href = DocsRuntime.obtenerURL(stylePath);
    if (!href) return;

    const link = document.createElement("link");
    link.id = elementId;
    link.rel = "stylesheet";
    link.href = href;
    if (link.dataset) {
      link.dataset.orchestratorExtensionId = obtenerIdExtension();
      link.dataset.orchestratorStyle = stylePath;
    } else {
      link.setAttribute(
        "data-docs-reviewer-extension-id",
        obtenerIdExtension(),
      );
      link.setAttribute("data-docs-reviewer-style", stylePath);
    }
    target.appendChild(link);
  });
}

/**
 * Orchestrator: coordina la lectura, el análisis de reglas y la
 * sincronización entre el panel (sidebar) y el overlay inline.
 */
export const Orchestrator = {
  // Lista de coincidencias enriquecidas con rects que alimenta el panel y resaltados.
  allMatches: [],
  // Mapa id -> issue para búsquedas rápidas y operaciones por id.
  issuesById: new Map(),
  // Id del issue actualmente activo (o null si no hay ninguno).
  activeIssueId: null,
  // Marca si el Orchestrator fue inicializado (evita ejecuciones duplicadas).
  isInitialized: false,
  // Texto completo del documento (source of truth para offsets).
  sourceText: "",
  // Segmentos/metadatos del documento (opcional, provisto por el lector).
  sourceSegments: [],
  isAnalyzing: false,
  _pendingReanalysis: false,
  _pendingReanalysisOptions: null,
  _reanalizarTimer: null,

  async inicializar() {
    if (this.isInitialized) return;

    const docId = DocsReader.obtenerIdDocumento();
    if (!docId) {
      console.log(
        "[LenguajeClaro] La URL no corresponde a un documento de Google Docs",
      );
      return;
    }

    if (await estaDeshabilitado(docId)) {
      console.log(
        "[LenguajeClaro] Deshabilitado para este documento o globalmente",
      );
      return;
    }

    inyectarEstilosContenido();
    await DocsPanel.inyectar();
    DocsHighlighter.inicializar();
    await this.analizarDocumento({ interactive: false });

    this.isInitialized = true;
  },

  obtenerMapaReglas() {
    return new Map(rules.map((rule) => [rule.id, rule]));
  },

  // Elimina matches completamente contenidos dentro de otro match más largo.
  // Si el solapamiento es parcial (ninguno contiene al otro), conserva ambos.
  deduplicarCoincidencias(matches) {
    const sorted = [...matches].sort(
      (a, b) => b.fin - b.inicio - (a.fin - a.inicio),
    );
    const kept = [];
    for (const match of sorted) {
      const isContained = kept.some(
        (accepted) =>
          accepted.inicio <= match.inicio && match.fin <= accepted.fin,
      );
      if (!isContained) {
        kept.push(match);
      }
    }
    return kept;
  },

  enriquecerCoincidencias(matches) {
    const ruleMap = this.obtenerMapaReglas();
    const normalizedSource = DocsHighlighter.normalizarTextoOrigenConMapa(
      this.sourceText,
    );

    const usedIssueIds = new Map();

    return matches.map((match) => {
      const rule = ruleMap.get(match.regla) || {};
      const normalizedRange = this.mapearCoincidenciaARangoNormalizado(
        normalizedSource.indexMap,
        match.inicio,
        match.fin,
      );

      const ordinals = this.calcularOrdinalesEnFuente(
        normalizedSource.normalizedText,
        match.textoOriginal,
        normalizedRange.start,
      );
      const context = this.calcularContextoCoincidencia(
        normalizedSource.normalizedText,
        normalizedRange.start,
        normalizedRange.end,
      );

      // El id visual debe sobrevivir a cambios de offset y a cambios de
      // ordinal cuando se edita texto antes del issue; por eso se basa en el
      // texto normalizado y su contexto local, no en la posición absoluta.
      const normalizedNeedleForId = DocsHighlighter.normalizarTexto(
        match.textoOriginal || "",
      );
      const issueIdentityKey = this.crearClaveIdentidadIssue(
        match,
        normalizedNeedleForId,
        context,
      );
      const issueIdBase = this.crearBaseIdIssue(match.regla, issueIdentityKey);
      const stableId = this.crearIdUnicoIssue(issueIdBase, usedIssueIds);

      return {
        ...match,
        id: stableId,
        issueIdentityKey,
        issueIdBase,
        color: rule.color || "#1a73e8",
        reglaNombre: rule.nombre || match.regla,
        reglaDescripcion: rule.descripcion || "",
        normalizedStart: normalizedRange.start,
        normalizedEnd: normalizedRange.end,
        ordinalExacto: ordinals.exacto,
        ordinalMinusculas: ordinals.minusculas,
        contextBeforeExact: context.before,
        contextAfterExact: context.after,
        contextBeforeLower: context.before.toLocaleLowerCase(),
        contextAfterLower: context.after.toLocaleLowerCase(),
        rects: [],
        isVisible: false,
        isActive: false,
      };
    });
  },

  crearClaveIdentidadIssue(match, normalizedNeedle, context) {
    const before = this.normalizarContextoId(context?.before || "", "before");
    const after = this.normalizarContextoId(context?.after || "", "after");
    const primaryContext =
      after.length >= 4 ? `after:${after}` : `before:${before}`;

    return [match?.regla || "", normalizedNeedle || "", primaryContext].join(
      "|",
    );
  },

  normalizarContextoId(context, side) {
    const normalized = DocsHighlighter.normalizarTexto(context || "");
    return side === "before" ? normalized.slice(-12) : normalized.slice(0, 12);
  },

  crearBaseIdIssue(regla, identityKey) {
    const ruleSlug = String(regla || "issue")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    return `${ruleSlug || "issue"}-${this.hashTextoEstable(identityKey)}`;
  },

  crearIdUnicoIssue(baseId, usedIssueIds) {
    const count = usedIssueIds.get(baseId) || 0;
    usedIssueIds.set(baseId, count + 1);
    return count === 0 ? baseId : `${baseId}-${count}`;
  },

  hashTextoEstable(text) {
    let hash = 2166136261;
    const value = String(text || "");

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
  },

  calcularOrdinalesEnFuente(normalizedSource, textoOriginal, normalizedStart) {
    // Cuenta cuántas veces aparece el needle en el texto normalizado del
    // documento antes de la posición del match. Esto distingue ocurrencias
    // que caen dentro de matches de otros issues con texto más largo.
    if (!textoOriginal || !normalizedSource) {
      return { exacto: 0, minusculas: 0 };
    }

    const exactNeedle = DocsHighlighter.normalizarTextoExacto(textoOriginal);
    const lowerNeedle = DocsHighlighter.normalizarTexto(textoOriginal);
    const prefix = normalizedSource.slice(
      0,
      Number.isInteger(normalizedStart) ? normalizedStart : 0,
    );

    return {
      exacto: exactNeedle ? this.contarOcurrencias(prefix, exactNeedle) : 0,
      minusculas: lowerNeedle
        ? this.contarOcurrencias(prefix.toLocaleLowerCase(), lowerNeedle)
        : 0,
    };
  },

  contarOcurrencias(haystack, needle) {
    if (!needle) return 0;
    let count = 0;

    if (!haystack || needle.length > haystack.length) {
      return count;
    }

    const limit = haystack.length - needle.length;
    for (let start = 0; start <= limit; start += 1) {
      if (haystack.startsWith(needle, start)) {
        count += 1;
      }
    }

    return count;
  },

  calcularContextoCoincidencia(normalizedSource, start, end) {
    if (
      !normalizedSource ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      end <= start
    ) {
      return { before: "", after: "" };
    }

    return {
      before: normalizedSource.slice(
        Math.max(0, start - ISSUE_CONTEXT_WINDOW),
        start,
      ),
      after: normalizedSource.slice(end, end + ISSUE_CONTEXT_WINDOW),
    };
  },

  mapearCoincidenciaARangoNormalizado(indexMap, start, end) {
    if (!Array.isArray(indexMap) || !Number.isInteger(start) || start < 0) {
      return { start: null, end: null };
    }

    const safeEnd = Number.isInteger(end)
      ? Math.max(end, start + 1)
      : start + 1;
    let normalizedStart = null;
    let normalizedEnd = null;

    for (let index = start; index < safeEnd; index += 1) {
      const normalizedIndex = indexMap[index];

      if (!Number.isInteger(normalizedIndex)) continue;

      if (normalizedStart === null) {
        normalizedStart = normalizedIndex;
      }

      normalizedEnd = normalizedIndex + 1;
    }

    return {
      start: normalizedStart,
      end: normalizedEnd,
    };
  },

  async analizarDocumento(options = {}) {
    if (this.isAnalyzing) {
      this._pendingReanalysis = true;
      this._pendingReanalysisOptions = {
        ...(this._pendingReanalysisOptions || {}),
        ...options,
      };
      return;
    }

    this.isAnalyzing = true;
    this._pendingReanalysis = false;
    this._pendingReanalysisOptions = null;

    try {
      const isInitialAnalysis = this.allMatches.length === 0;
      const silencioso = Boolean(options.silencioso);
      const invalidarCacheCanvas = Boolean(options.invalidarCacheCanvas);
      const preservarEstadoVisible =
        (Boolean(options.preservarPanel) || silencioso) && this.isInitialized;

      if (isInitialAnalysis && !preservarEstadoVisible) {
        DocsPanel.mostrarCargando();
      }
      if (invalidarCacheCanvas) {
        DocsHighlighter.invalidarCacheCanvas?.();
      }
      DocsHighlighter.limpiar({
        preservarCacheCanvas:
          !invalidarCacheCanvas &&
          (isInitialAnalysis || preservarEstadoVisible),
        preservarMarcadores: preservarEstadoVisible,
      });

      // Para re-análisis silencioso (ctrl+z), usar el modelo interno de Kix que
      // refleja el estado local inmediatamente, sin esperar sync con la REST API.
      let documento;
      if (silencioso) {
        try {
          const textoAccesor = await DocsEditor.pedirAccesorTexto();
          documento = textoAccesor
            ? { text: textoAccesor, segments: [] }
            : null;
        } catch (e) {
          console.warn(
            "[LenguajeClaro] accessor no disponible, usando REST API:",
            e,
          );
          documento = await DocsReader.leerDocumento(options);
        }
      } else {
        documento = await DocsReader.leerDocumento(options);
      }
      const textoCompleto = documento?.text;

      if (!textoCompleto) {
        const readError = DocsReader.lastReadError;

        if (readError?.code === "EXTENSION_CONTEXT_INVALIDATED") {
          this.manejarContextoExtensionInvalidado(readError);
          return;
        }

        if (readError?.code === "AUTH_REQUIRED") {
          DocsPanel.mostrarErrorAuth();
          return;
        }

        DocsPanel.mostrarError(
          readError?.message || "Sin acceso al documento.",
        );
        return;
      }
      this.sourceText = textoCompleto;
      this.sourceSegments = Array.isArray(documento?.segments)
        ? documento.segments
        : [];

      const collectedMatches = [];

      if (rules.length > 0) {
        rules.forEach((regla) => {
          try {
            const matches = regla.detectar(textoCompleto);
            collectedMatches.push(...matches);
          } catch (e) {
            console.error(`[LenguajeClaro] Error en regla ${regla.id}:`, e);
          }
        });
      } else {
        console.warn("[LenguajeClaro] No hay reglas disponibles");
      }

      this.allMatches = this.enriquecerCoincidencias(
        this.deduplicarCoincidencias(collectedMatches),
      ).sort((a, b) => {
        if (a.inicio !== b.inicio) return a.inicio - b.inicio;
        return a.fin - b.fin;
      });
      this.issuesById = new Map(
        this.allMatches.map((issue) => [issue.id, issue]),
      );
      this.activeIssueId = null;

      DocsPanel.actualizarIssues(this.allMatches);
      await DocsHighlighter.aplicarResaltados(this.allMatches, {
        preservarEstadoVisible,
      });
    } finally {
      this.isAnalyzing = false;
      if (this._pendingReanalysis) {
        this._pendingReanalysis = false;
        const pendingOptions = this._pendingReanalysisOptions || {};
        this._pendingReanalysisOptions = null;
        setTimeout(() => this.analizarDocumento(pendingOptions), 0);
      }
    }
  },

  obtenerIssue(issueOrId) {
    if (!issueOrId) return null;
    if (typeof issueOrId === "string") {
      return this.issuesById.get(issueOrId) || null;
    }
    return issueOrId;
  },

  establecerIssueActivo(issueId, options = {}) {
    this.activeIssueId = issueId;
    this.allMatches.forEach((issue) => {
      issue.isActive = issue.id === issueId;
    });

    DocsPanel.establecerIssueActivo(issueId, options);
    DocsHighlighter.establecerIssueActivo(issueId, options);
  },

  limpiarIssueActivo(options = {}) {
    this.establecerIssueActivo(null, options);
  },

  enfocarIssue(issueOrId) {
    const issue = this.obtenerIssue(issueOrId);
    if (!issue) return false;

    this.establecerIssueActivo(issue.id, { desplazarPanel: true });
    return DocsHighlighter.enfocarIssue(issue.id);
  },

  esContextoExtensionInvalidado(error) {
    return (
      error?.code === "EXTENSION_CONTEXT_INVALIDATED" ||
      DocsRuntime.estaContextoInvalidado(error)
    );
  },

  manejarContextoExtensionInvalidado(_error) {
    this.allMatches = [];
    this.issuesById = new Map();
    this.activeIssueId = null;
    DocsHighlighter.limpiar();
    DocsPanel.mostrarErrorExtensionRecargada();
  },

  async aplicarCorreccion(issueOrId, chosenSugerencia = null) {
    const issue = this.obtenerIssue(issueOrId);
    if (!issue) return;
    // Capturar los rectángulos visibles del issue antes del reemplazo
    let preRects = [];
    if (window.DocsHighlighter && DocsHighlighter.currentRects) {
      preRects = DocsHighlighter.currentRects.get(issue.id) || [];
    }

    const sugerencias = Array.isArray(issue.sugerencias)
      ? issue.sugerencias
      : [];
    const sugerencia = chosenSugerencia || sugerencias[0];

    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    if (!sugerencia || PLACEHOLDER_SUGGESTIONS.includes(sugerencia)) {
      this.establecerIssueActivo(issue.id, {
        mostrarPopup: true,
        fijarPopup: true,
      });
      return;
    }

    try {
      await DocsEditor.aplicarReemplazo({
        inicio: issue.inicio,
        fin: issue.fin,
        textoOriginal: issue.textoOriginal,
        textoReemplazo: sugerencia,
        normalizedStart: issue.normalizedStart,
        normalizedEnd: issue.normalizedEnd,
        ordinalExacto: issue.ordinalExacto,
        ordinalMinusculas: issue.ordinalMinusculas,
      });

      DocsHighlighter.invalidarCacheCanvas?.();
      this.activeIssueId = null;
      await this.analizarDocumento({
        preservarPanel: true,
        silencioso: true,
        invalidarCacheCanvas: true,
      });
      // Flash visual sobre los rects previos al reemplazo usando la función interna
      if (preRects && preRects.length && DocsHighlighter.mostrarDestelloFoco) {
        DocsHighlighter.mostrarDestelloFoco(issue.id);
      }
      this.reanalizarTrasEdicion();
    } catch (error) {
      if (this.esContextoExtensionInvalidado(error)) {
        this.manejarContextoExtensionInvalidado(error);
        return;
      }

      console.error(
        "[LenguajeClaro] Error al aplicar corrección:",
        error?.originalMessage || error?.message || error,
      );
      DocsPanel.mostrarToastError(
        "Error al aplicar: " + (error?.message || "desconocido"),
      );
    }
  },

  reanalizarTrasEdicion(delayMs = 700) {
    // Después de editar, reanalizamos desde el accessor local de Kix para
    // evitar que el panel quede desfasado mientras la API remota sincroniza.
    if (this._reanalizarTimer) clearTimeout(this._reanalizarTimer);
    this._reanalizarTimer = setTimeout(() => {
      this._reanalizarTimer = null;
      if (DocsHighlighter.tieneInteraccionPopupActiva()) {
        this.reanalizarTrasEdicion(250);
        return;
      }
      void this.analizarDocumento({
        preservarPanel: true,
        silencioso: true,
        invalidarCacheCanvas: true,
      });
    }, delayMs);
  },

  forzarReanalisisInmediato() {
    if (this._reanalizarTimer) {
      clearTimeout(this._reanalizarTimer);
      this._reanalizarTimer = null;
    }
    void this.analizarDocumento({
      silencioso: true,
      invalidarCacheCanvas: true,
    });
  },
};

establecerAccionesReviewer(Orchestrator);
Orchestrator.inicializar();

export default Orchestrator;
