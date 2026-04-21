import { DocsPanel } from "../panel.jsx";
import { obtenerAccionesReviewer } from "../reviewer-actions.js";
import { mantenerCase } from "../../rules/shared.js";

const HIDE_POPUP_DELAY_MS = 300;
const POPUP_POINTER_OFFSET_X_PX = -30;
const POPUP_POINTER_OFFSET_Y_PX = 8;

export const highlighterPopupMethods = {
  intentarOcultarPopup(relatedTarget) {
    if (this.isPopupHovered) return;
    if (relatedTarget?.closest?.("#docs-reviewer-popup")) return;
    if (this.pinnedIssueId) return;

    this.cancelarOcultacionPopup();
    this.hidePopupTimer = window.setTimeout(() => {
      if (!this.pinnedIssueId && !this.isPopupHovered) {
        obtenerAccionesReviewer().limpiarIssueActivo({
          preservarPopupFijado: false,
        });
      }
    }, HIDE_POPUP_DELAY_MS);
  },

  cancelarOcultacionPopup() {
    if (this.hidePopupTimer) {
      window.clearTimeout(this.hidePopupTimer);
      this.hidePopupTimer = null;
    }
  },

  tienePopupVisibleParaIssue(issueId) {
    return Boolean(issueId && this.visiblePopupIssueId === issueId);
  },

  tienePopupVisibleParaOtroIssue(issueId) {
    return Boolean(
      issueId &&
      !this.pinnedIssueId &&
      this.visiblePopupIssueId &&
      this.visiblePopupIssueId !== issueId,
    );
  },

  actualizarAnclaPopup(issueId, anchor = {}) {
    if (!issueId) return;

    const { clientX, clientY } = anchor;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rectIndex = Number.isInteger(anchor.rectIndex)
      ? anchor.rectIndex
      : this.obtenerIndiceRectTriggerPopup(issueId, clientX, clientY);

    this.popupAnchor = {
      issueId,
      clientX,
      clientY,
      rectIndex,
    };
  },

  limpiarAnclaPopup(issueId = null) {
    if (!this.popupAnchor) return;
    if (!issueId || this.popupAnchor.issueId === issueId) {
      this.popupAnchor = null;
    }
  },

  obtenerAnclaPopup(issueId) {
    if (this.popupAnchor?.issueId !== issueId) return null;

    const { clientX, clientY } = this.popupAnchor;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    return {
      clientX,
      clientY,
    };
  },

  obtenerDistanciaCuadradaPuntoARect(rect, x, y) {
    const right = "right" in rect ? rect.right : rect.left + rect.width;
    const bottom = "bottom" in rect ? rect.bottom : rect.top + rect.height;
    const dx = x < rect.left ? rect.left - x : x > right ? x - right : 0;
    const dy = y < rect.top ? rect.top - y : y > bottom ? y - bottom : 0;
    return dx * dx + dy * dy;
  },

  obtenerIndiceRectTriggerPopup(issueId, x, y) {
    const rects = this.currentRects.get(issueId) || [];
    if (!rects.length) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;

    const hoveredIndex = rects.findIndex((rect) =>
      this.estaPuntoDentroDeAreaHover(rect, x, y),
    );
    if (hoveredIndex !== -1) return hoveredIndex;

    return rects.reduce(
      (best, rect, index) => {
        const distance = this.obtenerDistanciaCuadradaPuntoARect(rect, x, y);
        if (distance < best.distance) {
          return { index, distance };
        }
        return best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    ).index;
  },

  obtenerRectTriggerPopup(issueId, rects) {
    if (!Array.isArray(rects) || !rects.length) return null;

    const anchor = this.obtenerAnclaPopup(issueId);
    if (!anchor) return rects[0];
    if (Number.isInteger(anchor.rectIndex) && rects[anchor.rectIndex]) {
      return rects[anchor.rectIndex];
    }

    const hoveredRect = rects.find((rect) =>
      this.estaPuntoDentroDeAreaHover(rect, anchor.clientX, anchor.clientY),
    );
    if (hoveredRect) return hoveredRect;

    return rects.reduce((bestRect, rect) => {
      if (!bestRect) return rect;

      const bestDistance = this.obtenerDistanciaCuadradaPuntoARect(
        bestRect,
        anchor.clientX,
        anchor.clientY,
      );
      const currentDistance = this.obtenerDistanciaCuadradaPuntoARect(
        rect,
        anchor.clientX,
        anchor.clientY,
      );
      return currentDistance < bestDistance ? rect : bestRect;
    }, null);
  },

  reposicionarPopupParaIssue(issueId) {
    if (!issueId || !this.popupElement) return;

    const rects = this.currentRects.get(issueId) || [];
    const triggerRect = this.obtenerRectTriggerPopup(issueId, rects);
    if (!triggerRect) return;

    this.posicionarPopup(triggerRect, issueId);
  },

  mostrarPopup(issueId) {
    const issue = obtenerAccionesReviewer().obtenerIssue(issueId);
    const rects = this.currentRects.get(issueId) || [];

    if (!issue || !rects.length || !this.popupElement) {
      if (!this.pinnedIssueId) {
        this.ocultarPopup();
      }
      return;
    }

    const popupYaVisibleParaIssue =
      this.visiblePopupIssueId === issueId &&
      !this.popupElement.classList?.contains?.("docs-reviewer-popup-hidden") &&
      this.popupElement.dataset?.issueId === issueId;

    this.visiblePopupIssueId = issueId;
    if (!popupYaVisibleParaIssue) {
      if (!this.popupElement.dataset) {
        this.popupElement.dataset = {};
      }
      this.popupElement.dataset.issueId = issueId;
      this.popupElement.innerHTML = this.renderizarHtmlPopup(issue);
      this.enlazarAccionesPopup(issue);
    }
    this.popupElement.classList.remove("docs-reviewer-popup-hidden");
    this.reposicionarPopupParaIssue(issueId);
    requestAnimationFrame(() => {
      if (
        !this.popupElement?.classList.contains("docs-reviewer-popup-hidden")
      ) {
        this.reposicionarPopupParaIssue(issueId);
      }
    });
  },

  renderizarHtmlPopup(issue) {
    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    const hasMultipleSugerencias =
      Array.isArray(issue.sugerencias) && issue.sugerencias.length > 1;
    const isHintOnly = issue.aplicable === false;
    const unica =
      Array.isArray(issue.sugerencias) && issue.sugerencias.length === 1
        ? issue.sugerencias[0]
        : null;
    const canApply =
      !isHintOnly && !!unica && !PLACEHOLDER_SUGGESTIONS.includes(unica);
    const safeRuleName = this.escaparHtml(issue.reglaNombre);
    const safeOriginal = this.escaparHtml(issue.textoOriginal);
    // Construir la línea de flecha y texto
    let suggestionLabelHTML = "";
    // Solo mostrar la etiqueta cuando hay una sola sugerencia aplicable
    if (!isHintOnly && canApply && !hasMultipleSugerencias) {
      suggestionLabelHTML = `<div class=\"docs-reviewer-popup-suggestion-label\"><span class=\"docs-reviewer-popup-suggestion-arrow\">↓</span> <span>sugerencia</span></div>`;
    }

    const suggestionHTML =
      isHintOnly && unica
        ? `<div class="docs-reviewer-popup-hint">${this.escaparHtml(unica)}</div>`
        : canApply && !hasMultipleSugerencias && unica
          ? `${suggestionLabelHTML}<div class="docs-reviewer-popup-suggestion">${this.escaparHtml(unica)}</div>`
          : "";
    const logoUrl = chrome.runtime.getURL("assets/icons/icon-32.png");

    let actionsHTML = "";
    if (!isHintOnly && hasMultipleSugerencias) {
      const buttons = issue.sugerencias
        .map((sugerencia) => {
          const display = mantenerCase(issue.textoOriginal, sugerencia);
          return `<button type="button" class="docs-reviewer-popup-button docs-reviewer-popup-button-suggestion" data-action="apply" data-sugerencia="${this.escaparHtml(sugerencia)}">${this.escaparHtml(display)}</button>`;
        })
        .join("");
      actionsHTML = `<div class="docs-reviewer-popup-actions docs-reviewer-popup-actions-multi"><span class="docs-reviewer-popup-actions-label"><span class="docs-reviewer-popup-suggestion-arrow">↓</span>sugerencias</span>${buttons}</div>`;
    } else if (!isHintOnly && canApply && unica) {
      actionsHTML = `
      <div class="docs-reviewer-popup-actions">
        <button type="button" class="docs-reviewer-popup-button docs-reviewer-popup-button-primary" data-action="apply" data-sugerencia="${this.escaparHtml(unica)}">Aplicar cambio</button>
      </div>`;
    }

    return `
      <div class="docs-reviewer-popup-header">
        <span class="docs-reviewer-popup-rule" style="--docs-reviewer-popup-color: ${issue.color}">${safeRuleName}</span>
        <button type="button" class="docs-reviewer-popup-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="docs-reviewer-popup-body">
        <div class="docs-reviewer-popup-original">${safeOriginal}</div>
        ${suggestionHTML}
      </div>
      ${actionsHTML}
      <div class="docs-reviewer-popup-footer">
      <button type="button" class="docs-reviewer-popup-footer-link" data-action="panel">Abrir panel</button>
      <img src="${logoUrl}" class="docs-reviewer-popup-logo" alt="">
      </div>
    `;
  },

  _cerrarPopup(issueId) {
    this.pinnedIssueId = null;
    this.limpiarAnclaPopup(issueId);
    obtenerAccionesReviewer().limpiarIssueActivo();
  },

  enlazarAccionesPopup(issue) {
    this.popupElement
      .querySelector(".docs-reviewer-popup-close")
      ?.addEventListener("click", () => {
        this._cerrarPopup(issue.id);
      });

    this.popupElement
      .querySelectorAll('[data-action="apply"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          const chosen = button.dataset.sugerencia || null;
          obtenerAccionesReviewer().aplicarCorreccion(issue.id, chosen);
        });
      });

    this.popupElement
      .querySelector('[data-action="panel"]')
      ?.addEventListener("click", () => {
        DocsPanel.mostrar();
        this.pinnedIssueId = issue.id;
        obtenerAccionesReviewer().establecerIssueActivo(issue.id, {
          mostrarPopup: true,
          fijarPopup: true,
          desplazarPanel: true,
          desplazarPanelAlInicio: true,
          destacar: true,
        });

        this._cerrarPopup(issue.id);
      });
  },

  posicionarPopup(triggerRect, issueId = null) {
    const hostRect = this.obtenerRectHostOverlay();
    const popupRect = this.popupElement.getBoundingClientRect();
    const anchor = issueId ? this.obtenerAnclaPopup(issueId) : null;
    const viewportMargin = 12;
    let left = anchor
      ? anchor.clientX + POPUP_POINTER_OFFSET_X_PX
      : triggerRect.left;
    let top = anchor
      ? anchor.clientY + POPUP_POINTER_OFFSET_Y_PX
      : triggerRect.bottom + viewportMargin;

    if (anchor && left + popupRect.width > window.innerWidth - viewportMargin) {
      left = anchor.clientX - popupRect.width - POPUP_POINTER_OFFSET_X_PX;
    }
    if (left + popupRect.width > window.innerWidth - viewportMargin) {
      left = window.innerWidth - popupRect.width - viewportMargin;
    }
    if (left < viewportMargin) {
      left = viewportMargin;
    }

    if (top + popupRect.height > window.innerHeight - viewportMargin) {
      top = anchor
        ? anchor.clientY - popupRect.height - POPUP_POINTER_OFFSET_Y_PX
        : triggerRect.top - popupRect.height - viewportMargin;
    }
    if (top < viewportMargin) {
      top = viewportMargin;
    }

    const popupOrigin = this.convertirViewportAHost(left, top, hostRect);
    this.popupElement.style.left = `${popupOrigin.left}px`;
    this.popupElement.style.top = `${popupOrigin.top}px`;
  },

  ocultarPopup() {
    if (!this.popupElement) return;
    this.isPopupHovered = false;
    this.visiblePopupIssueId = null;
    if (this.popupElement.dataset) {
      delete this.popupElement.dataset.issueId;
    }
    this.popupElement.classList.add("docs-reviewer-popup-hidden");
    this.popupElement.innerHTML = "";
  },

  manejarClickDocumento(event) {
    if (
      event.target.closest("#docs-reviewer-popup") ||
      event.target.closest("#docs-reviewer-overlay") ||
      event.target.closest("#docs-reviewer-panel")
    ) {
      return;
    }

    this.pinnedIssueId = null;
    this.limpiarAnclaPopup();
    obtenerAccionesReviewer().limpiarIssueActivo();
  },
};
