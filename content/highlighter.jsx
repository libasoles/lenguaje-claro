import { obtenerAccionesReviewer } from "./reviewer-actions.js";
import { highlighterCanvasMethods } from "./highlighter-modules/canvas.js";
import { highlighterMarkerMethods } from "./highlighter-modules/markers.js";
import { highlighterPopupMethods } from "./highlighter-modules/marker-popup.js";
import { highlighterSharedMethods } from "./highlighter-modules/shared.js";

const REANALYZE_DEBOUNCE_MS = 400;
const OVERLAY_HOST_SELECTOR = ".kix-appview-editor-container";
const ISSUE_SCROLL_TOP_MARGIN_PX = 50;

/**
 * DocsHighlighter administra el overlay visual y la interacción de los resaltados en Google Docs.
 * Cada propiedad tiene un propósito específico en el manejo de marcadores, popups y sincronización visual.
 */
export const DocsHighlighter = {
  /** Elemento raíz del overlay de resaltados en el DOM */
  overlayElement: null,
  /** Elemento raíz del popup contextual en el DOM */
  popupElement: null,
  /** Elemento host donde se inserta el overlay (contenedor de Google Docs) */
  overlayHostElement: null,
  /** Lista de issues detectados actualmente en el documento */
  issues: [],
  /** Mapa de issueId → array de elementos marcador en el overlay */
  issueMarkers: new Map(),
  /** Mapa de issueId → array de rectángulos visuales actuales */
  currentRects: new Map(),
  /** Snapshots de markers visibles antes del último reanálisis preservado */
  _previousVisibleIssueSnapshots: [],
  /** Modelos de texto actuales, uno por canvas/tile visible */
  currentCanvasModels: [],
  /** Rango normalizado del documento cubierto por canvases visibles resueltos */
  currentDocumentViewport: null,
  /** ID del issue actualmente activo (hover o foco) */
  activeIssueId: null,
  /** ID del issue fijado (popup anclado) */
  pinnedIssueId: null,
  /** ID del issue actualmente bajo el puntero */
  hoverIssueId: null,
  /** ID del issue cuyo popup está bajo el puntero */
  hoverPopupIssueId: null,
  /** true si el popup está siendo hovered */
  isPopupHovered: false,
  /** requestAnimationFrame ID para el recálculo pendiente */
  recalcFrame: 0,
  /** Timer para ocultar el popup (setTimeout) */
  hidePopupTimer: null,
  /** Timer para mostrar el popup (setTimeout) */
  showPopupTimer: null,
  /** ID de issue pendiente de hover en el popup */
  pendingHoverPopupIssueId: null,
  /** Elemento DOM al que está anclado el popup */
  popupAnchor: null,
  /** ID del issue cuyo popup es visible actualmente */
  visiblePopupIssueId: null,
  /** Timer para reanalizar el documento tras edición */
  reanalysisTimer: null,
  /** Generación actual de recálculo de posiciones (para descartar async viejos) */
  _recalcGeneration: 0,
  /** Motivo pendiente de recálculo (scroll, resize, etc) */
  _pendingRecalcReason: null,
  /** Función para medir el canvas (usada internamente) */
  _measureCanvas: null,
  /** Últimos datos de fragmentos de canvas renderizados */
  _lastRenderedCanvasData: null,
  /** Timestamp del último render de canvas */
  _lastRenderedCanvasAt: 0,
  /** true después de editar hasta recibir un canvas fresco */
  _awaitingFreshCanvasAfterEdit: false,
  /** Elementos DOM del destello de foco actual */
  _flashElements: [],
  /** Timer para limpiar el destello de foco */
  _flashTimer: null,
  /** IssueId pendiente de enfocar tras scroll */
  _pendingFocus: null,
  /** Referencia al documento del iframe de edición de Docs */
  _iframeEditDoc: null,
  /** Referencia al documento del iframe para Ctrl+Z/Undo */
  _iframeUndoDoc: null,

  inicializar() {
    if (this.overlayElement && this.popupElement) return;

    this.overlayElement = document.createElement("div");
    this.overlayElement.id = "docs-reviewer-overlay";
    this.overlayElement.className = "docs-reviewer-overlay";

    this.popupElement = (
      <div
        id="docs-reviewer-popup"
        className="docs-reviewer-popup docs-reviewer-popup-hidden"
        onMouseEnter={() => {
          this.isPopupHovered = true;
          this.cancelarOcultacionPopup();
        }}
        onMouseLeave={(event) => {
          this.isPopupHovered = false;
          if (!this.pinnedIssueId) {
            this.intentarOcultarPopup(event.relatedTarget);
          }
        }}
      />
    );

    this.asegurarHostOverlay();

    window.addEventListener("resize", () => this.programarRecalculo("resize"));
    const handleScroll = (event) => {
      if (event.target?.closest?.("#docs-reviewer-panel")) return;
      this.programarRecalculo("scroll");
    };
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener(
      "mousemove",
      (event) => this.manejarMovimientoPuntero(event),
      true,
    );

    document.addEventListener(
      "keydown",
      (event) => this.manejarTeclaDocumento(event),
      true,
    );

    this.observarUndoEnIframe();

    void this.solicitarFragmentosCanvas().then(({ canvasResults, source }) => {
      if (
        source !== "empty" &&
        source !== "timeout" &&
        canvasResults.length > 0
      ) {
        this.guardarDatosCanvasRenderizado(canvasResults);
      }
    });
  },

  asegurarListenersIframe() {
    const iframe = document.querySelector("iframe.docs-texteventtarget-iframe");
    const doc = iframe?.contentDocument;
    if (!doc) return false;

    if (this._iframeEditDoc !== doc) {
      ["beforeinput", "input", "paste", "cut", "compositionend"].forEach(
        (eventName) => {
          doc.addEventListener(
            eventName,
            (event) => this.manejarEdicionDocumento(event),
            true,
          );
        },
      );
      doc.addEventListener(
        "keydown",
        (event) => this.manejarTeclaEdicionDocumento(event),
        true,
      );
      this._iframeEditDoc = doc;
    }

    if (this._iframeUndoDoc !== doc) {
      doc.addEventListener(
        "keydown",
        (event) => {
          const key = event.key?.toLocaleLowerCase?.() || "";
          const isModifierUndoRedo =
            (event.ctrlKey || event.metaKey) && (key === "z" || key === "y");

          if (isModifierUndoRedo) {
            // Damos tiempo a que Kix procese el undo/redo antes de releer.
            window.setTimeout(() => {
              obtenerAccionesReviewer().forzarReanalisisInmediato?.();
            }, 150);
          }
        },
        true,
      );
      this._iframeUndoDoc = doc;
    }

    return true;
  },

  observarUndoEnIframe() {
    const intentarAdjuntar = (reintento = 0) => {
      if (!this.asegurarListenersIframe()) {
        if (reintento < 30) {
          window.setTimeout(() => intentarAdjuntar(reintento + 1), 500);
        }
        return;
      }
    };
    intentarAdjuntar();
  },

  async aplicarResaltados(allMatches, options = {}) {
    const preservarEstadoVisible = Boolean(options.preservarEstadoVisible);

    this.inicializar();
    this._previousVisibleIssueSnapshots = preservarEstadoVisible
      ? this.capturarIssuesVisiblesPrevios()
      : [];
    this.issues = allMatches || [];

    if (!preservarEstadoVisible) {
      this.pinnedIssueId = null;
      this.hoverIssueId = null;
      this.hoverPopupIssueId = null;
      this.activeIssueId = null;
      this.popupAnchor = null;
      this.visiblePopupIssueId = null;
      this.renderizarMarcadores(new Map());
    }

    this.programarRecalculo();
  },

  limpiar(options = {}) {
    const preservarCacheCanvas = Boolean(options.preservarCacheCanvas);
    const preservarMarcadores = Boolean(options.preservarMarcadores);
    this.cancelarOcultacionPopup();
    this.cancelarProgramacionPopup?.();
    if (this.recalcFrame) {
      cancelAnimationFrame(this.recalcFrame);
      this.recalcFrame = 0;
    }
    if (this.reanalysisTimer) {
      window.clearTimeout(this.reanalysisTimer);
      this.reanalysisTimer = null;
    }

    if (!preservarCacheCanvas) {
      this._lastRenderedCanvasData = null;
      this._lastRenderedCanvasAt = 0;
      this.currentCanvasModels = [];
      this.currentDocumentViewport = null;
    }
    if (!preservarMarcadores) {
      this._awaitingFreshCanvasAfterEdit = false;
      this._previousVisibleIssueSnapshots = [];
      this.isPopupHovered = false;
      this.hoverIssueId = null;
      this.hoverPopupIssueId = null;
      this.popupAnchor = null;
      this.visiblePopupIssueId = null;
      this.currentRects = new Map();
      this.issueMarkers.forEach((markers) => {
        markers.forEach((marker) => marker.remove());
      });
      this.issueMarkers.clear();
      this.ocultarPopup();
    }
  },

  invalidarCacheCanvas(options = {}) {
    const clearLiveCanvas = Boolean(options.clearLiveCanvas);
    const alreadyAwaitingFreshCanvas = this._awaitingFreshCanvasAfterEdit;
    this._lastRenderedCanvasData = null;
    this._lastRenderedCanvasAt = 0;
    this.currentCanvasModels = [];
    this.currentDocumentViewport = null;
    this._normalizedSourceCache = null;
    this._awaitingFreshCanvasAfterEdit = true;
    this._recalcGeneration += 1;

    if (
      (alreadyAwaitingFreshCanvas && !clearLiveCanvas) ||
      typeof document === "undefined" ||
      typeof document.dispatchEvent !== "function"
    ) {
      return;
    }

    let event;
    if (typeof CustomEvent === "function") {
      event = new CustomEvent("docs-reviewer-invalidate-canvas-cache", {
        detail: { clearLiveCanvas },
      });
    } else if (typeof Event === "function") {
      event = new Event("docs-reviewer-invalidate-canvas-cache");
      event.detail = { clearLiveCanvas };
    } else {
      event = {
        type: "docs-reviewer-invalidate-canvas-cache",
        detail: { clearLiveCanvas },
      };
    }
    document.dispatchEvent(event);
  },

  guardarDatosCanvasRenderizado(canvasResults) {
    if (!Array.isArray(canvasResults) || !canvasResults.length) return false;

    this._lastRenderedCanvasData = canvasResults;
    this._lastRenderedCanvasAt = Date.now();
    return true;
  },

  capturarIssuesVisiblesPrevios() {
    const snapshots = [];

    (this.issues || []).forEach((issue) => {
      if (!issue?.id) return;

      const rects = this.currentRects?.get(issue.id) || [];
      if (!rects.length) return;

      snapshots.push({
        issue,
        issueId: issue.id,
        rects,
        keys: this.obtenerClavesPreservacionIssue(issue),
      });
    });

    return snapshots;
  },

  obtenerClavesPreservacionIssue(issue) {
    if (!issue) return [];

    const keys = [];
    if (issue.issueIdentityKey) {
      keys.push(`identity:${issue.issueIdentityKey}`);
    }
    if (issue.issueIdBase) {
      keys.push(`base:${issue.issueIdBase}`);
    }

    const normalizedNeedle = this.normalizarTexto(issue.textoOriginal || "");
    if (issue.regla && normalizedNeedle) {
      const before = this.normalizarTexto(issue.contextBeforeExact || "");
      const after = this.normalizarTexto(issue.contextAfterExact || "");
      keys.push(
        `context:${issue.regla}|${normalizedNeedle}|${before}|${after}`,
      );
    }

    return [...new Set(keys)];
  },

  buscarSnapshotVisibleParaIssue(issue, usedSnapshots) {
    const issueKeys = this.obtenerClavesPreservacionIssue(issue);
    if (!issueKeys.length) return null;

    return (this._previousVisibleIssueSnapshots || []).find((snapshot) => {
      if (!snapshot?.rects?.length || usedSnapshots.has(snapshot)) {
        return false;
      }

      return snapshot.keys?.some((key) => issueKeys.includes(key));
    });
  },

  conservarRectangulosPreviosFaltantes(issueRects) {
    const mergedRects = new Map(issueRects instanceof Map ? issueRects : []);
    let preservedCount = 0;
    const usedSnapshots = new Set();

    (this.issues || []).forEach((issue) => {
      if (!issue?.id) return;

      const nextRects = mergedRects.get(issue.id) || [];
      if (nextRects.length) return;

      const previousRects = this.currentRects?.get(issue.id) || [];
      if (previousRects.length) {
        mergedRects.set(issue.id, previousRects);
        preservedCount += 1;
        return;
      }

      const previousSnapshot = this.buscarSnapshotVisibleParaIssue(
        issue,
        usedSnapshots,
      );
      if (!previousSnapshot) return;

      usedSnapshots.add(previousSnapshot);
      mergedRects.set(issue.id, previousSnapshot.rects);
      preservedCount += 1;
    });

    return { issueRects: mergedRects, preservedCount };
  },

  tieneInteraccionPopupActiva() {
    if (this.isPopupHovered || this.pinnedIssueId) return true;
    if (!this.visiblePopupIssueId || !this.popupElement) return false;

    return !this.popupElement.classList?.contains?.(
      "docs-reviewer-popup-hidden",
    );
  },

  async recalcularPosiciones(reason = "general") {
    if (!this.overlayElement) return;
    if (!this.issues?.length) {
      this.currentCanvasModels = [];
      this.currentDocumentViewport = null;
      this.renderizarMarcadores(new Map());
      return;
    }

    const generation = ++this._recalcGeneration;
    const isViewportChangingRecalc =
      reason === "scroll" || reason === "focus-scroll";
    const allowSnapshotFallback = !isViewportChangingRecalc;
    const requestTimeout =
      reason === "scroll" ? 120 : reason === "focus-scroll" ? 1000 : 800;
    const { canvasResults, source } = await this.solicitarFragmentosCanvas({
      timeout: requestTimeout,
      allowSnapshotFallback,
    });
    if (generation !== this._recalcGeneration) return;
    let canvasData = canvasResults;

    if (!canvasData.length) {
      const cacheAgeMs = Date.now() - (this._lastRenderedCanvasAt || 0);
      if (
        !isViewportChangingRecalc &&
        !this._awaitingFreshCanvasAfterEdit &&
        this._lastRenderedCanvasData?.length &&
        cacheAgeMs < 1200
      ) {
        canvasData = this._lastRenderedCanvasData;
      } else {
        this.currentCanvasModels = [];
        this.currentDocumentViewport = null;
        if (this._awaitingFreshCanvasAfterEdit && !isViewportChangingRecalc) {
          return;
        }
        this.renderizarMarcadores(new Map());
        return;
      }
    }

    const shouldPreserveMissingRects =
      this._awaitingFreshCanvasAfterEdit && !isViewportChangingRecalc;

    if (source === "live" && canvasData.length > 0) {
      this.guardarDatosCanvasRenderizado(canvasData);
    }

    const canvasModels = this.construirModelosTextoPorCanvas(canvasData);
    let issueRects = this.mapearIssuesARectangulosDesdeCanvas(canvasModels);
    let preservedCount = 0;
    if (shouldPreserveMissingRects) {
      const mergeResult = this.conservarRectangulosPreviosFaltantes(issueRects);
      issueRects = mergeResult.issueRects;
      preservedCount = mergeResult.preservedCount;
    }

    if (generation === this._recalcGeneration) {
      this.currentCanvasModels = canvasModels;
      this.currentDocumentViewport =
        this.obtenerVentanaDocumentoVisibleDesdeCanvasModels(canvasModels);
      if (source === "live" && canvasData.length > 0 && preservedCount === 0) {
        this._awaitingFreshCanvasAfterEdit = false;
        this._previousVisibleIssueSnapshots = [];
      }
      this.renderizarMarcadores(issueRects);
    }
  },

  priorizarMotivoRecalculo(currentReason, nextReason) {
    const priorities = {
      scroll: 0,
      general: 1,
      resize: 2,
      "focus-scroll": 3,
      "canvas-rendered": 4,
    };
    if (!currentReason) return nextReason;
    return (priorities[nextReason] ?? 0) >= (priorities[currentReason] ?? 0)
      ? nextReason
      : currentReason;
  },

  programarRecalculo(reason = "general") {
    this._pendingRecalcReason = this.priorizarMotivoRecalculo(
      this._pendingRecalcReason,
      reason,
    );
    if (this.recalcFrame) return;
    this.recalcFrame = requestAnimationFrame(() => {
      this.recalcFrame = 0;
      const nextReason = this._pendingRecalcReason || "general";
      this._pendingRecalcReason = null;
      this.recalcularPosiciones(nextReason);
    });
  },

  programarReanalisis() {
    this.invalidarCacheCanvas();
    if (this.reanalysisTimer) window.clearTimeout(this.reanalysisTimer);
    this.reanalysisTimer = window.setTimeout(() => {
      this.reanalysisTimer = null;
      obtenerAccionesReviewer().analizarDocumento({
        preservarPanel: true,
        silencioso: true,
        invalidarCacheCanvas: true,
      });
    }, REANALYZE_DEBOUNCE_MS);
  },

  esTeclaEdicionDocumento(event) {
    if (!event || event.defaultPrevented) return false;

    const key = event.key || "";
    if (!key) return false;

    if (event.ctrlKey || event.metaKey) {
      const lowerKey = key.toLocaleLowerCase();
      return lowerKey === "v" || lowerKey === "x";
    }

    if (event.isComposing || key === "Process" || key === "Unidentified") {
      return true;
    }

    if (key.length === 1) return true;

    return ["Backspace", "Delete", "Enter", "Tab"].includes(key);
  },

  manejarTeclaDocumento(event) {
    if (event?.key === "Escape") {
      this.pinnedIssueId = null;
      this.limpiarAnclaPopup?.();
      obtenerAccionesReviewer().limpiarIssueActivo();
      return;
    }

    this.manejarTeclaEdicionDocumento(event);
  },

  manejarTeclaEdicionDocumento(event) {
    if (!this.esTeclaEdicionDocumento(event)) return;
    this.manejarEdicionDocumento(event);
  },

  manejarEdicionDocumento(event) {
    const target = event?.target;
    const tipeoSobreElPanel = target?.closest?.("#docs-reviewer-panel");
    if (tipeoSobreElPanel) {
      return;
    }
    this.programarReanalisis();
  },

  obtenerHostOverlay() {
    return document.querySelector(OVERLAY_HOST_SELECTOR) || document.body;
  },

  asegurarHostOverlay() {
    const host = this.obtenerHostOverlay();
    if (!host || !this.overlayElement || !this.popupElement) {
      return document.body;
    }

    if (this.overlayHostElement !== host) {
      if (host !== document.body) {
        const computedStyle = window.getComputedStyle(host);
        if (computedStyle.position === "static") {
          host.style.position = "relative";
        }
      }
      host.appendChild(this.overlayElement);
      host.appendChild(this.popupElement);
      this.overlayHostElement = host;
    }

    const anchoredToHost = host !== document.body;
    this.overlayElement.style.position = anchoredToHost ? "absolute" : "fixed";
    this.overlayElement.style.inset = "0";
    this.overlayElement.style.zIndex = anchoredToHost ? "20" : "200";
    this.popupElement.style.position = anchoredToHost ? "absolute" : "fixed";
    this.popupElement.style.zIndex = anchoredToHost ? "30" : "210";
    return host;
  },

  obtenerRectHostOverlay() {
    const host = this.asegurarHostOverlay();
    if (host && host !== document.body && host.getBoundingClientRect) {
      const rect = host.getBoundingClientRect();
      if (rect.width || rect.height) {
        return rect;
      }
    }

    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  },

  convertirViewportAHost(x, y, hostRect = this.obtenerRectHostOverlay()) {
    return {
      left: x - hostRect.left,
      top: y - hostRect.top,
    };
  },

  establecerIssueActivo(issueId, options = {}) {
    this.activeIssueId = issueId;
    this.actualizarClasesMarcadores();

    const shouldPin = Boolean(options.fijarPopup && issueId);
    if (shouldPin) {
      this.pinnedIssueId = issueId;
    } else if (
      !options.preservarPopupFijado &&
      this.pinnedIssueId === issueId
    ) {
      this.pinnedIssueId = null;
    } else if (!issueId && !options.preservarPopupFijado) {
      this.pinnedIssueId = null;
    }

    if (!issueId) {
      if (!this.pinnedIssueId) {
        this.ocultarPopup();
      }
      return;
    }

    if (
      options.mostrarPopup ||
      shouldPin ||
      this.hoverPopupIssueId === issueId
    ) {
      this.mostrarPopup(issueId);
      return;
    }

    if (!this.pinnedIssueId) {
      this.ocultarPopup();
    }
  },

  enfocarIssue(issueId) {
    const rects = this.currentRects.get(issueId) || [];
    if (!rects.length) {
      return this.enfocarIssueOffscreen(issueId);
    }

    return this.enfocarIssueConRectangulos(issueId, rects);
  },

  enfocarIssueConRectangulos(issueId, rects, options = {}) {
    if (!rects?.length) return false;

    this.desplazarRectanguloAVistaSiNecesario(rects[0]);
    this.establecerIssueActivo(issueId, {
      mostrarPopup: false,
      fijarPopup: false,
    });
    if (options.diferirDestello) {
      window.setTimeout(() => this.mostrarDestelloFoco(issueId), 50);
    } else {
      this.mostrarDestelloFoco(issueId);
    }
    this.reposicionarDestelloTrasCroll();
    return true;
  },

  mostrarDestelloFoco(issueId) {
    this.limpiarDestelloFoco();
    const rects = this.currentRects.get(issueId) || [];
    if (!rects.length || !this.overlayElement) return;
    const issue = obtenerAccionesReviewer().obtenerIssue(issueId);
    const color = "#ffe066";
    this._flashIssueId = issueId;
    this._flashColor = color;

    rects.forEach((rect) =>
      this._flashElements.push(this.crearElementoFlash(rect, color)),
    );

    this._flashTimer = window.setTimeout(() => {
      this._flashElements.forEach((el) => (el.style.opacity = "0"));
      window.setTimeout(() => this.limpiarDestelloFoco(), 320);
    }, 4000);
  },

  crearElementoFlash(rect, color) {
    const hostRect = this.obtenerRectHostOverlay();
    const flashOrigin = this.convertirViewportAHost(
      rect.left - 2,
      rect.top - 8,
      hostRect,
    );
    const el = document.createElement("div");
    el.className = "docs-reviewer-focus-flash docs-reviewer-focus-flash-pulse";
    const height = Math.max(rect.height + 6, 18);
    el.style.position = "absolute";
    el.style.left = `${flashOrigin.left}px`;
    el.style.top = `${flashOrigin.top}px`;
    el.style.width = `${rect.width + 4}px`;
    el.style.height = `${height}px`;
    el.style.background = `${color}44`;
    el.style.borderRadius = "3px";
    el.style.pointerEvents = "none";
    el.style.transition = "opacity 300ms ease";
    el.style.opacity = "1";
    el.style.zIndex = "40";
    this.overlayElement.appendChild(el);
    return el;
  },

  reposicionarDestelloFoco() {
    if (!this._flashIssueId || !this._flashElements.length) return;
    const rects = this.currentRects.get(this._flashIssueId) || [];
    this._flashElements.forEach((el) => el.remove());
    this._flashElements = [];
    if (!rects.length) return;
    rects.forEach((rect) =>
      this._flashElements.push(
        this.crearElementoFlash(rect, this._flashColor || "#ffe066"),
      ),
    );
  },

  reposicionarDestelloTrasCroll() {
    const container = this.obtenerContenedorDesplazamiento();
    const scrollTarget =
      container === document.scrollingElement ||
      container === document.documentElement
        ? window
        : container;
    let repositioned = false;
    const reposition = () => {
      if (repositioned) return;
      repositioned = true;
      this.reposicionarDestelloFoco();
    };
    scrollTarget.addEventListener("scrollend", reposition, { once: true });
    window.setTimeout(reposition, 600);
  },

  limpiarDestelloFoco() {
    if (this._flashTimer) {
      window.clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    this._flashElements.forEach((el) => el.remove());
    this._flashElements = [];
    this._flashIssueId = null;
  },

  async enfocarIssueOffscreen(issueId) {
    const issue = obtenerAccionesReviewer().obtenerIssue(issueId);
    if (!issue) return false;

    await this.recalcularPosiciones("general");
    let rects = this.currentRects.get(issueId) || [];
    if (rects.length) {
      return this.enfocarIssueConRectangulos(issueId, rects, {
        diferirDestello: true,
      });
    }

    const container = this.obtenerContenedorDesplazamiento();
    const isWindowContainer =
      container === document.scrollingElement ||
      container === document.documentElement;
    const clientHeight = isWindowContainer
      ? window.innerHeight
      : container.clientHeight;
    let triedApproximateScroll = false;

    if (this.debeDesplazarAproximadamenteAIssue(issue)) {
      triedApproximateScroll = true;
      const focused = await this.desplazarYBuscarIssue(
        issueId,
        () =>
          this.desplazarAproximadamenteAIssue(
            issue,
            container,
            isWindowContainer,
          ),
        900,
      );
      if (focused) return true;
    }

    rects = this.currentRects.get(issueId) || [];
    if (rects.length) {
      return this.enfocarIssueConRectangulos(issueId, rects, {
        diferirDestello: true,
      });
    }

    if (this.currentDocumentViewport) {
      const target = this.obtenerPosicionNormalizadaIssue(issue);
      const { minDocStart, maxDocEnd } = this.currentDocumentViewport;
      const insideViewport =
        Number.isInteger(target) && target >= minDocStart && target < maxDocEnd;

      if (insideViewport && !triedApproximateScroll) {
        triedApproximateScroll = true;
        const focused = await this.desplazarYBuscarIssue(
          issueId,
          () =>
            this.desplazarAproximadamenteAIssue(
              issue,
              container,
              isWindowContainer,
            ),
          900,
        );
        if (focused) return true;
      }
    } else if (!triedApproximateScroll) {
      triedApproximateScroll = true;
      const focused = await this.desplazarYBuscarIssue(
        issueId,
        () =>
          this.desplazarAproximadamenteAIssue(
            issue,
            container,
            isWindowContainer,
          ),
        900,
      );
      if (focused) return true;
    }

    let stepPx = Math.max(clientHeight * 0.85, 240);
    let previousDirection = 0;
    let previousScrollTop = this.obtenerScrollTopContenedor(
      container,
      isWindowContainer,
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const direction = this.determinarDireccionScrollHaciaIssue(issue);
      if (!direction) break;
      if (previousDirection && direction !== previousDirection) {
        stepPx = Math.max(stepPx * 0.5, clientHeight * 0.25, 120);
      }
      previousDirection = direction;

      const focused = await this.desplazarYBuscarIssue(
        issueId,
        () =>
          this.desplazarContenedorPor(
            container,
            isWindowContainer,
            direction * stepPx,
          ),
        700,
      );
      if (focused) return true;

      const nextScrollTop = this.obtenerScrollTopContenedor(
        container,
        isWindowContainer,
      );
      if (Math.abs(nextScrollTop - previousScrollTop) < 1) break;
      previousScrollTop = nextScrollTop;
    }

    return false;
  },

  debeDesplazarAproximadamenteAIssue(issue) {
    const target = this.obtenerPosicionNormalizadaIssue(issue);
    const viewport = this.currentDocumentViewport;

    if (!viewport) {
      return Number.isInteger(target);
    }

    if (!Number.isInteger(target)) return false;

    const { minDocStart, maxDocEnd } = viewport;
    const insideViewport = target >= minDocStart && target < maxDocEnd;
    if (insideViewport) return true;

    const viewportSpan = Math.max(1, maxDocEnd - minDocStart);
    const distance =
      target < minDocStart ? minDocStart - target : target - maxDocEnd;
    return distance > viewportSpan * 2;
  },

  async desplazarYBuscarIssue(issueId, desplazar, timeoutMs = 700) {
    const canvasRenderizado = this.esperarCanvasRendered(timeoutMs, {
      recalcReason: "focus-scroll",
    });
    desplazar();
    await canvasRenderizado;
    await this.recalcularPosiciones("focus-scroll");

    const rects = this.currentRects.get(issueId) || [];
    if (!rects.length) return false;

    return this.enfocarIssueConRectangulos(issueId, rects, {
      diferirDestello: true,
    });
  },

  obtenerPosicionNormalizadaIssue(issue) {
    if (Number.isInteger(issue?.normalizedStart)) return issue.normalizedStart;
    if (Number.isInteger(issue?.inicio)) return issue.inicio;
    return null;
  },

  determinarDireccionScrollHaciaIssue(issue) {
    const target = this.obtenerPosicionNormalizadaIssue(issue);
    if (!Number.isInteger(target)) {
      return this.adivinarDireccionScroll(issue);
    }

    const viewport = this.currentDocumentViewport;
    if (viewport) {
      if (target < viewport.minDocStart) return -1;
      if (target >= viewport.maxDocEnd) return 1;
      return 0;
    }

    return this.adivinarDireccionScroll(issue);
  },

  obtenerScrollTopContenedor(container, isWindowContainer) {
    if (isWindowContainer) {
      return (
        window.scrollY ||
        document.documentElement?.scrollTop ||
        document.scrollingElement?.scrollTop ||
        0
      );
    }

    return container?.scrollTop || 0;
  },

  desplazarContenedorPor(container, isWindowContainer, top) {
    if (isWindowContainer) {
      if (typeof window.scrollBy === "function") {
        window.scrollBy({ top, behavior: "auto" });
      } else if (document.documentElement) {
        document.documentElement.scrollTop =
          (document.documentElement.scrollTop || 0) + top;
      }
      return;
    }

    if (typeof container?.scrollBy === "function") {
      container.scrollBy({ top, behavior: "auto" });
      return;
    }
    if (container) {
      container.scrollTop = (container.scrollTop || 0) + top;
    }
  },

  desplazarContenedorA(container, isWindowContainer, top) {
    if (isWindowContainer) {
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top, behavior: "auto" });
      } else if (document.documentElement) {
        document.documentElement.scrollTop = top;
      }
      return;
    }

    if (typeof container?.scrollTo === "function") {
      container.scrollTo({ top, behavior: "auto" });
      return;
    }
    if (container) {
      container.scrollTop = top;
    }
  },

  desplazarAproximadamenteAIssue(issue, container, isWindowContainer) {
    const sourceText = obtenerAccionesReviewer().sourceText || "";
    const normalizedSource = this.obtenerFuenteNormalizada?.();
    const sourceLength =
      normalizedSource?.normalizedText?.length || sourceText.length;
    const issuePosition = this.obtenerPosicionNormalizadaIssue(issue);
    const fraction =
      sourceLength > 0 && Number.isInteger(issuePosition)
        ? issuePosition / sourceLength
        : 0.5;
    const scrollHeight = isWindowContainer
      ? document.documentElement?.scrollHeight || 0
      : container.scrollHeight;
    const clientHeight = isWindowContainer
      ? window.innerHeight
      : container.clientHeight;
    const targetScrollTop = fraction * Math.max(0, scrollHeight - clientHeight);

    this.desplazarContenedorA(container, isWindowContainer, targetScrollTop);
  },

  esperarCanvasRendered(timeoutMs = 400, options = {}) {
    const recalcReason = options.recalcReason || "general";
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener("docs-reviewer-canvas-rendered", onRender);
        this.programarRecalculo(recalcReason);
        window.setTimeout(resolve, 180);
      };
      const onRender = () => finish();
      document.addEventListener("docs-reviewer-canvas-rendered", onRender, {
        once: true,
      });
      window.setTimeout(finish, timeoutMs);
    });
  },

  obtenerContenedorDesplazamiento() {
    const canvas = document.querySelector("canvas");
    let current = canvas?.parentElement || null;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  },

  desplazarRectanguloAVistaSiNecesario(rect) {
    const container = this.obtenerContenedorDesplazamiento();
    const isWindowContainer =
      container === document.scrollingElement ||
      container === document.documentElement;
    const containerTop = isWindowContainer
      ? 0
      : container.getBoundingClientRect().top;
    const viewportHeight = isWindowContainer
      ? window.innerHeight
      : container.getBoundingClientRect().height;
    const relTop = rect.top - containerTop;
    const topMargin = ISSUE_SCROLL_TOP_MARGIN_PX;

    // Already comfortably top-aligned (within 60px of target margin and bottom visible)
    if (
      relTop >= topMargin &&
      relTop <= topMargin + 60 &&
      rect.bottom - containerTop <= viewportHeight
    ) {
      return;
    }

    const scrollDelta = rect.top - containerTop - topMargin;
    const behavior = "smooth";

    if (isWindowContainer) {
      window.scrollBy({ top: scrollDelta, behavior });
      return;
    }
    container.scrollBy({ top: scrollDelta, behavior });
  },

  // TODO: esto es un smell. Muy oscuro inyectar metodos así. Deberíamos tener una clase o algo más explícito.
  ...highlighterSharedMethods,
  ...highlighterCanvasMethods,
  ...highlighterMarkerMethods,
  ...highlighterPopupMethods,
};

export default DocsHighlighter;
