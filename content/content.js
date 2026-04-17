// content.js - Orquesta el análisis usando la Google Docs API vía background service worker
// y sincroniza panel + overlay inline.

const DocsReviewer = {
  allMatches: [],
  issuesById: new Map(),
  activeIssueId: null,
  isInitialized: false,
  sourceText: "",
  sourceSegments: [],
  undoStack: [],
  isUndoInFlight: false,
  isAnalyzing: false,
  _pendingReanalysis: false,

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
    this.inicializarUndo();
    await this.analizarDocumento({ interactive: false });

    this.isInitialized = true;
    console.log("[Legal Docs] Inicialización completada");
  },

  getRuleMap() {
    const rules = window.docsReviewerRules || [];
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

      console.log(`[Legal Docs] Match ${match.regla}: inicio=${match.inicio}, fin=${match.fin}, normalized=${JSON.stringify(normalizedRange)}, text="${match.textoOriginal}"`);

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
      return;
    }

    this.isAnalyzing = true;
    this._pendingReanalysis = false;

    try {
      if (this.allMatches.length === 0) {
        DocsPanel.mostrarCargando();
      }
      DocsHighlighter.limpiar();
      console.log("[Legal Docs] Obteniendo texto del documento...");

      const documento = await DocsReader.leerDocumento(options);
      const textoCompleto = documento?.text;

      if (!textoCompleto) {
        const readError = DocsReader.lastReadError;

        console.log("[Legal Docs] No se pudo obtener el texto del documento");

        if (readError?.code === "AUTH_REQUIRED") {
          DocsPanel.mostrarErrorAuth();
          return;
        }

        DocsPanel.mostrarError(readError?.message || "Sin acceso al documento.");
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

      if (window.docsReviewerRules?.length > 0) {
        window.docsReviewerRules.forEach((regla) => {
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

      this.allMatches = this.enriquecerMatches(collectedMatches).sort((a, b) => {
        if (a.inicio !== b.inicio) return a.inicio - b.inicio;
        return a.fin - b.fin;
      });
      this.issuesById = new Map(
        this.allMatches.map((issue) => [issue.id, issue]),
      );
      this.activeIssueId = null;

      console.log(
        `[Legal Docs] Total: ${this.allMatches.length} problemas detectados`,
      );

      DocsPanel.actualizarIssues(this.allMatches);
      await DocsHighlighter.aplicarHighlights(this.allMatches);
    } finally {
      this.isAnalyzing = false;
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

  aplicarCorreccion(issueOrId) {
    const issue = this.getIssue(issueOrId);
    if (!issue) return;

    if (issue.regla === "arcaismos" && issue.sugerencia) {
      const docId = DocsReader.getDocumentId();
      if (!docId) return;

      const apiRange = this.mapStringRangeToApiRange(
        this.sourceSegments,
        issue.inicio,
        issue.fin,
      );
      if (!apiRange) {
        alert("No se pudo ubicar el texto a reemplazar en Google Docs.");
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: "APPLY_REPLACEMENT",
          docId,
          original: issue.textoOriginal,
          replacement: issue.sugerencia,
          range: apiRange,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "[Legal Docs] Error al aplicar corrección:",
              chrome.runtime.lastError.message,
            );
            alert("Error al aplicar la corrección. Inténtalo de nuevo.");
            return;
          }

          if (response?.success) {
            this.undoStack.push({
              originalText: issue.textoOriginal,
              replacementText: issue.sugerencia,
              sourceStart: issue.inicio,
            });
            this.analizarDocumento();
            return;
          }

          console.error("[Legal Docs] Error de API:", response?.error);
          alert(
            "Error al aplicar la corrección: " +
              (response?.error || "desconocido"),
          );
        },
      );
      return;
    }

    this.enfocarIssue(issue.id, { showPopup: true, pinPopup: true });
  },

  inicializarUndo() {
    document.addEventListener("keydown", (event) => {
      const isUndoShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z";

      if (!isUndoShortcut || !this.undoStack.length || this.isUndoInFlight) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.deshacerUltimoCambio();
    });
  },

  async deshacerUltimoCambio() {
    const lastChange = this.undoStack[this.undoStack.length - 1];
    if (!lastChange) return;

    const docId = DocsReader.getDocumentId();
    if (!docId) return;

    this.isUndoInFlight = true;

    try {
      const documento = await DocsReader.leerDocumento({ interactive: true });
      if (!documento?.text) {
        throw new Error(
          "No se pudo leer el documento para deshacer el cambio.",
        );
      }

      const replacementStart = this.findNearestOccurrence(
        documento.text,
        lastChange.replacementText,
        lastChange.sourceStart,
      );

      if (replacementStart < 0) {
        throw new Error("No se encontró el cambio aplicado para deshacerlo.");
      }

      const replacementEnd =
        replacementStart + lastChange.replacementText.length;
      const apiRange = this.mapStringRangeToApiRange(
        documento.segments,
        replacementStart,
        replacementEnd,
      );

      if (!apiRange) {
        throw new Error("No se pudo mapear el cambio al documento actual.");
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "APPLY_REPLACEMENT",
            docId,
            original: lastChange.replacementText,
            replacement: lastChange.originalText,
            range: apiRange,
          },
          resolve,
        );
      });

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      if (!response?.success) {
        throw new Error(response?.error || "No se pudo deshacer el cambio.");
      }

      this.undoStack.pop();
      await this.analizarDocumento();
    } catch (error) {
      console.error("[Legal Docs] Error al deshacer cambio:", error);
      alert(error.message || "No se pudo deshacer el cambio.");
    } finally {
      this.isUndoInFlight = false;
    }
  },

  findNearestOccurrence(text, fragment, approximateIndex = 0) {
    if (!text || !fragment) return -1;

    let fromIndex = 0;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    while (fromIndex <= text.length) {
      const foundIndex = text.indexOf(fragment, fromIndex);
      if (foundIndex < 0) break;

      const distance = Math.abs(foundIndex - approximateIndex);
      if (distance < nearestDistance) {
        nearestIndex = foundIndex;
        nearestDistance = distance;
      }

      fromIndex = foundIndex + 1;
    }

    return nearestIndex;
  },

  mapStringRangeToApiRange(segments, start, end) {
    const startIndex = this.mapStringPositionToApiIndex(segments, start);
    const endIndex = this.mapStringPositionToApiIndex(segments, end);

    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
      return null;
    }

    if (endIndex <= startIndex) {
      return null;
    }

    return { startIndex, endIndex };
  },

  mapStringPositionToApiIndex(segments, position) {
    if (
      !Array.isArray(segments) ||
      !Number.isInteger(position) ||
      position < 0
    ) {
      return null;
    }

    for (const segment of segments) {
      const segmentStart = segment.strStart;
      const segmentEnd = segment.strStart + segment.length;

      if (position < segmentStart || position > segmentEnd) {
        continue;
      }

      return segment.apiStart + (position - segmentStart);
    }

    return null;
  },
};

DocsReviewer.init();
