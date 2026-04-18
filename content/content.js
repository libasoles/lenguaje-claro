// content.js - Orquesta el análisis usando la Google Docs API vía background service worker
// y sincroniza panel + overlay inline.

import { rules } from "../rules/index.js";
import { DocsEditor } from "./docs-editor.js";
import { DocsHighlighter } from "./highlighter.js";
import { DocsPanel } from "./panel.js";
import { DocsReader } from "./reader.js";
import { setReviewerActions } from "./reviewer-actions.js";
import { DocsRuntime } from "./runtime.js";

export const DocsReviewer = {
  allMatches: [],
  issuesById: new Map(),
  activeIssueId: null,
  isInitialized: false,
  sourceText: "",
  sourceSegments: [],
  isAnalyzing: false,
  _pendingReanalysis: false,
  _analysisRunId: 0,
  _lastAnalysisStartedAt: 0,
  _reanalizarTimer: null,

  async init() {
    if (this.isInitialized) return;

    const docId = DocsReader.getDocumentId();
    if (!docId) {
      console.log(
        "[Legal Docs] URL no corresponde a un documento de Google Docs",
      );
      return;
    }

    console.log("[Legal Docs] Iniciando para documento:", docId);

    await DocsPanel.inyectar();
    DocsHighlighter.inicializar();
    await this.analizarDocumento({ interactive: false });

    this.isInitialized = true;
    console.log("[Legal Docs] Inicialización completada");
  },

  getDebugNow() {
    if (typeof performance !== "undefined" && performance?.now) {
      return performance.now();
    }
    return Date.now();
  },

  logAnalysisTrace(stage, detail = {}) {
    const startedAt = this._lastAnalysisStartedAt || this.getDebugNow();
    console.log("[Legal Docs][Analysis]", {
      runId: this._analysisRunId,
      t: Math.round((this.getDebugNow() - startedAt) * 10) / 10,
      stage,
      ...detail,
    });
  },

  getRuleMap() {
    return new Map(rules.map((rule) => [rule.id, rule]));
  },

  enriquecerMatches(matches) {
    const ruleMap = this.getRuleMap();
    const normalizedSource = DocsHighlighter.normalizeSourceTextWithMap(
      this.sourceText,
    );

    return matches.map((match, index) => {
      const rule = ruleMap.get(match.regla) || {};
      const normalizedRange = this.mapMatchToNormalizedRange(
        normalizedSource.indexMap,
        match.inicio,
        match.fin,
      );

      console.log(
        `[Legal Docs] Match ${match.regla}: inicio=${match.inicio}, fin=${match.fin}, normalized=${JSON.stringify(normalizedRange)}, text="${match.textoOriginal}"`,
      );

      return {
        ...match,
        id: match.id || `${match.regla}-${index}`,
        color: rule.color || "#1a73e8",
        reglaNombre: rule.nombre || match.regla,
        reglaDescripcion: rule.descripcion || "",
        normalizedStart: normalizedRange.start,
        normalizedEnd: normalizedRange.end,
        rects: [],
        isVisible: false,
        isActive: false,
      };
    });
  },

  mapMatchToNormalizedRange(indexMap, start, end) {
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
      this.logAnalysisTrace("queued-reanalysis", {
        interactive: Boolean(options.interactive),
      });
      return;
    }

    this.isAnalyzing = true;
    this._pendingReanalysis = false;
    this._analysisRunId += 1;
    this._lastAnalysisStartedAt = this.getDebugNow();
    this.logAnalysisTrace("start", {
      interactive: Boolean(options.interactive),
      existingIssues: this.allMatches.length,
    });

    try {
      const isInitialAnalysis = this.allMatches.length === 0;
      const preserveVisibleState = Boolean(options.preservePanel) && this.isInitialized;

      if (isInitialAnalysis && !preserveVisibleState) {
        DocsPanel.mostrarCargando();
      }
      DocsHighlighter.limpiar({
        preserveCanvasCache: isInitialAnalysis || preserveVisibleState,
        preserveMarkers: preserveVisibleState,
      });
      console.log("[Legal Docs] Obteniendo texto del documento...");

      const documento = await DocsReader.leerDocumento(options);
      const textoCompleto = documento?.text;
      this.logAnalysisTrace("doc-read-finished", {
        hasText: Boolean(textoCompleto),
        textLength: textoCompleto?.length || 0,
        segments: Array.isArray(documento?.segments)
          ? documento.segments.length
          : 0,
      });

      if (!textoCompleto) {
        const readError = DocsReader.lastReadError;

        console.log("[Legal Docs] No se pudo obtener el texto del documento");

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

      console.log(
        "[Legal Docs] Texto leído (" + textoCompleto.length + " chars):",
        textoCompleto.substring(0, 100),
      );
      this.sourceText = textoCompleto;
      this.sourceSegments = Array.isArray(documento?.segments)
        ? documento.segments
        : [];

      const collectedMatches = [];

      if (rules.length > 0) {
        rules.forEach((regla) => {
          try {
            const matches = regla.detectar(textoCompleto);
            console.log(
              `[Legal Docs] Regla ${regla.id}: ${matches.length} coincidencias`,
            );
            collectedMatches.push(...matches);
          } catch (e) {
            console.error(`[Legal Docs] Error en regla ${regla.id}:`, e);
          }
        });
      } else {
        console.warn("[Legal Docs] No hay reglas disponibles");
      }

      this.allMatches = this.enriquecerMatches(collectedMatches).sort(
        (a, b) => {
          if (a.inicio !== b.inicio) return a.inicio - b.inicio;
          return a.fin - b.fin;
        },
      );
      this.issuesById = new Map(
        this.allMatches.map((issue) => [issue.id, issue]),
      );
      this.activeIssueId = null;

      console.log(
        `[Legal Docs] Total: ${this.allMatches.length} problemas detectados`,
      );
      this.logAnalysisTrace("rules-finished", {
        totalIssues: this.allMatches.length,
        ruleCount: rules.length,
      });

      DocsPanel.actualizarIssues(this.allMatches);
      this.logAnalysisTrace("panel-updated", {
        renderedIssues: this.allMatches.length,
      });
      await DocsHighlighter.aplicarHighlights(this.allMatches, {
        preserveVisibleState,
      });
      this.logAnalysisTrace("highlighter-bootstrap-finished", {
        issueCount: this.allMatches.length,
      });
    } finally {
      this.isAnalyzing = false;
      this.logAnalysisTrace("finish", {
        pendingReanalysis: this._pendingReanalysis,
      });
      if (this._pendingReanalysis) {
        this._pendingReanalysis = false;
        setTimeout(() => this.analizarDocumento(), 0);
      }
    }
  },

  getIssue(issueOrId) {
    if (!issueOrId) return null;
    if (typeof issueOrId === "string") {
      return this.issuesById.get(issueOrId) || null;
    }
    return issueOrId;
  },

  setIssueActivo(issueId, options = {}) {
    this.activeIssueId = issueId;
    this.allMatches.forEach((issue) => {
      issue.isActive = issue.id === issueId;
    });

    DocsPanel.setIssueActivo(issueId, options);
    DocsHighlighter.setIssueActivo(issueId, options);
  },

  limpiarIssueActivo(options = {}) {
    this.setIssueActivo(null, options);
  },

  enfocarIssue(issueOrId, options = {}) {
    const issue = this.getIssue(issueOrId);
    if (!issue) return false;

    const focusOptions = {
      showPopup: true,
      pinPopup: true,
      scrollPanel: true,
      ...options,
    };

    this.setIssueActivo(issue.id, focusOptions);
    return DocsHighlighter.focusIssue(issue.id, focusOptions);
  },

  esContextoExtensionInvalidado(error) {
    return (
      error?.code === "EXTENSION_CONTEXT_INVALIDATED" ||
      DocsRuntime.isContextInvalidated(error)
    );
  },

  manejarContextoExtensionInvalidado(error) {
    console.warn(
      "[Legal Docs] El contexto de la extensión fue invalidado:",
      error?.originalMessage || error?.message || error,
    );

    this.allMatches = [];
    this.issuesById = new Map();
    this.activeIssueId = null;
    DocsHighlighter.limpiar();
    DocsPanel.mostrarErrorExtensionRecargada();
  },

  async aplicarCorreccion(issueOrId, chosenSugerencia = null) {
    const issue = this.getIssue(issueOrId);
    if (!issue) return;

    const sugerencia = chosenSugerencia || issue.sugerencia;

    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    if (!sugerencia || PLACEHOLDER_SUGGESTIONS.includes(sugerencia)) {
      this.enfocarIssue(issue.id, { showPopup: true, pinPopup: true });
      return;
    }

    try {
      await DocsEditor.aplicarReemplazo({
        inicio: issue.inicio,
        fin: issue.fin,
        textoOriginal: issue.textoOriginal,
        textoReemplazo: sugerencia,
      });

      this.allMatches = [];
      this.issuesById = new Map();
      this.activeIssueId = null;
      DocsHighlighter.limpiar();
      DocsPanel.mostrarCargando();
      this.reanalizarTrasEdicion();
    } catch (error) {
      if (this.esContextoExtensionInvalidado(error)) {
        this.manejarContextoExtensionInvalidado(error);
        return;
      }

      console.error(
        "[Legal Docs] Error al aplicar corrección:",
        error?.originalMessage || error?.message || error,
      );
      DocsPanel.mostrarToastError(
        "Error al aplicar: " + (error?.message || "desconocido"),
      );
    }
  },

  reanalizarTrasEdicion() {
    // Damos un respiro para que Docs sincronice el cambio con el server
    // antes de releer via OAuth; si no, la regla podría reanalizar texto viejo.
    if (this._reanalizarTimer) clearTimeout(this._reanalizarTimer);
    this._reanalizarTimer = setTimeout(() => {
      this._reanalizarTimer = null;
      void this.analizarDocumento();
    }, 700);
  },
};

setReviewerActions(DocsReviewer);
DocsReviewer.init();

export default DocsReviewer;
