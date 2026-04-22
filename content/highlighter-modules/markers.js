import { obtenerAccionesReviewer } from "../reviewer-actions.js";

const MARKER_BAND_HEIGHT_PX = 6;
const HOVER_HITBOX_SIDE_PADDING_PX = 2;
const HOVER_HITBOX_TOP_PADDING_PX = 2;
const HOVER_HITBOX_BOTTOM_PADDING_PX = 8;
const HOVER_POPUP_DELAY_MS = 200;

export const highlighterMarkerMethods = {
  obtenerTopMarcador(rect) {
    if (Number.isFinite(rect?.underlineTop)) return rect.underlineTop;
    if (Number.isFinite(rect?.baselineY)) return rect.baselineY + 2;
    return rect?.bottom || 0;
  },

  renderizarMarcadores(issueRects) {
    this.currentRects = issueRects;
    this.sincronizarIssuesConRectangulos(issueRects);
    this.reposicionarDestelloFoco?.();

    this.issueMarkers.forEach((markers) => {
      markers.forEach((marker) => marker.remove());
    });
    this.issueMarkers.clear();

    if (!this.overlayElement) return;
    const hostRect = this.obtenerRectHostOverlay();
    this.overlayElement.style.display = "block";
    this.overlayElement.style.visibility = "visible";

    const editorEl = document.querySelector(".kix-appview-editor");
    const editorTop = editorEl ? editorEl.getBoundingClientRect().top : 0;

    issueRects.forEach((rects, issueId) => {
      const issue = obtenerAccionesReviewer().obtenerIssue(issueId);
      if (!issue || !rects.length) return;

      const markers = rects
        .map((rect) => {
          const markerTop = this.obtenerTopMarcador(rect);
          const markerHeight = MARKER_BAND_HEIGHT_PX;
          if (markerTop + markerHeight <= editorTop) return null;

          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = "docs-reviewer-highlight";
          marker.setAttribute("data-issue-id", issueId);
          marker.setAttribute("data-regla", issue.regla);
          const markerOrigin = this.convertirViewportAHost(
            rect.left,
            markerTop,
            hostRect,
          );
          marker.style.left = `${markerOrigin.left}px`;
          marker.style.top = `${markerOrigin.top}px`;
          marker.style.width = `${rect.width}px`;
          marker.style.height = `${markerHeight}px`;
          if (markerTop < editorTop) {
            marker.style.clipPath = `inset(${editorTop - markerTop}px 0 0 0)`;
          }
          marker.style.display = "block";
          marker.style.visibility = "visible";
          marker.style.opacity = "1";
          marker.style.boxSizing = "border-box";
          marker.style.background = "transparent";
          marker.style.setProperty(
            "--docs-reviewer-highlight-color",
            "#e67e22", //issue.color,
          );

          marker.addEventListener("mouseenter", (event) =>
            this.manejarEntradaMarcador(issueId, event),
          );
          marker.addEventListener("mouseleave", (event) =>
            this.manejarSalidaMarcador(issueId, event.relatedTarget),
          );
          marker.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.manejarClickMarcador(issueId, event);
          });

          this.overlayElement.appendChild(marker);
          return marker;
        })
        .filter(Boolean);

      this.issueMarkers.set(issueId, markers);
    });

    this.actualizarClasesMarcadores();

    if (this.pinnedIssueId && issueRects.get(this.pinnedIssueId)?.length) {
      this.mostrarPopup(this.pinnedIssueId);
      return;
    }

    if (
      this.hoverPopupIssueId &&
      issueRects.get(this.hoverPopupIssueId)?.length
    ) {
      this.mostrarPopup(this.hoverPopupIssueId);
      return;
    }

    this.ocultarPopup();
  },

  actualizarClasesMarcadores() {
    this.issueMarkers.forEach((markers, issueId) => {
      markers.forEach((marker) => {
        marker.classList.toggle(
          "docs-reviewer-highlight-active",
          issueId === this.activeIssueId,
        );
        marker.classList.toggle(
          "docs-reviewer-highlight-pinned",
          issueId === this.pinnedIssueId,
        );
        marker.style.background = "transparent";
        marker.style.boxShadow = "";
        marker.style.borderBottom = "";
      });
    });
  },

  cancelarProgramacionPopup() {
    if (this.showPopupTimer) {
      window.clearTimeout(this.showPopupTimer);
      this.showPopupTimer = null;
    }
    this.pendingHoverPopupIssueId = null;
  },

  obtenerAnclaPuntero(event) {
    if (
      Number.isFinite(event?.clientX) &&
      Number.isFinite(event?.clientY)
    ) {
      return {
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }

    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return null;

    const right = "right" in rect ? rect.right : rect.left + rect.width;
    const bottom = "bottom" in rect ? rect.bottom : rect.top + rect.height;
    return {
      clientX: (rect.left + right) / 2,
      clientY: (rect.top + bottom) / 2,
    };
  },

  programarMostrarPopupHover(issueId) {
    if (!issueId) return;
    if (this.hoverPopupIssueId === issueId) return;
    if (
      this.showPopupTimer &&
      this.pendingHoverPopupIssueId === issueId
    ) {
      return;
    }

    this.cancelarProgramacionPopup();
    this.pendingHoverPopupIssueId = issueId;
    this.showPopupTimer = window.setTimeout(() => {
      this.showPopupTimer = null;
      this.pendingHoverPopupIssueId = null;

      if (this.hoverIssueId !== issueId) return;

      this.hoverPopupIssueId = issueId;
      obtenerAccionesReviewer().establecerIssueActivo(issueId, {
        mostrarPopup: true,
      });
    }, HOVER_POPUP_DELAY_MS);
  },

  manejarEntradaHoverIssue(issueId, anchor = null) {
    if (!issueId) return;
    if (this.tienePopupVisibleParaOtroIssue?.(issueId)) {
      return;
    }

    const popupVisibleParaIssue = this.tienePopupVisibleParaIssue?.(issueId);

    if (anchor && this.pinnedIssueId !== issueId && !popupVisibleParaIssue) {
      this.actualizarAnclaPopup(issueId, anchor);
    }

    this.hoverIssueId = issueId;
    this.cancelarOcultacionPopup();

    if (popupVisibleParaIssue) {
      this.hoverPopupIssueId = issueId;
    } else if (this.hoverPopupIssueId !== issueId) {
      this.hoverPopupIssueId = null;
    }

    obtenerAccionesReviewer().establecerIssueActivo(issueId, {
      mostrarPopup: Boolean(popupVisibleParaIssue),
    });
    if (!popupVisibleParaIssue) {
      this.programarMostrarPopupHover(issueId);
    }
  },

  manejarEntradaMarcador(issueId, event) {
    this.manejarEntradaHoverIssue(issueId, this.obtenerAnclaPuntero(event));
  },

  manejarSalidaHoverIssue(issueId, relatedTarget) {
    if (this.hoverIssueId === issueId) {
      this.hoverIssueId = null;
    }

    if (relatedTarget?.closest?.("#docs-reviewer-popup")) {
      if (this.pendingHoverPopupIssueId === issueId) {
        this.cancelarProgramacionPopup();
      }
      return;
    }

    if (this.pinnedIssueId !== issueId) {
      this.limpiarAnclaPopup?.(issueId);
    }

    if (
      this.pendingHoverPopupIssueId === issueId ||
      this.hoverPopupIssueId === issueId
    ) {
      this.cancelarProgramacionPopup();
      this.hoverPopupIssueId = null;
    }

    if (!this.pinnedIssueId) {
      this.intentarOcultarPopup(relatedTarget);
    }
  },

  manejarSalidaMarcador(issueId, relatedTarget) {
    this.manejarSalidaHoverIssue(issueId, relatedTarget);
  },

  estaPuntoDentroDeAreaHover(rect, x, y) {
    const left = rect.left - HOVER_HITBOX_SIDE_PADDING_PX;
    const right =
      ("right" in rect ? rect.right : rect.left + rect.width) +
      HOVER_HITBOX_SIDE_PADDING_PX;
    const top = rect.top - HOVER_HITBOX_TOP_PADDING_PX;
    const bottom = rect.bottom + HOVER_HITBOX_BOTTOM_PADDING_PX;
    return x >= left && x <= right && y >= top && y <= bottom;
  },

  obtenerIssueHoverEnCoordenadas(x, y) {
    if (this.hoverIssueId) {
      const hoverRects = this.currentRects.get(this.hoverIssueId) || [];
      if (
        hoverRects.some((rect) => this.estaPuntoDentroDeAreaHover(rect, x, y))
      ) {
        return this.hoverIssueId;
      }
    }

    for (const [issueId, rects] of this.currentRects.entries()) {
      if (
        rects.some((rect) => this.estaPuntoDentroDeAreaHover(rect, x, y))
      ) {
        return issueId;
      }
    }

    return null;
  },

  manejarMovimientoPuntero(event) {
    if (!event || this.isPopupHovered) return;
    if (event.target?.closest?.("#docs-reviewer-popup")) return;

    const anchor = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    const hoveredIssueId = this.obtenerIssueHoverEnCoordenadas(
      event.clientX,
      event.clientY,
    );
    const anchorRectIndex = hoveredIssueId
      ? this.obtenerIndiceRectTriggerPopup?.(
          hoveredIssueId,
          event.clientX,
          event.clientY,
        )
      : null;
    const popupVisibleIssueId = this.visiblePopupIssueId;

    if (
      popupVisibleIssueId &&
      !this.pinnedIssueId &&
      hoveredIssueId !== popupVisibleIssueId
    ) {
      if (this.hoverIssueId === popupVisibleIssueId) {
        this.manejarSalidaHoverIssue(popupVisibleIssueId, null);
      }
      return;
    }

    if (
      hoveredIssueId &&
      this.pinnedIssueId !== hoveredIssueId &&
      !(
        this.hoverPopupIssueId === hoveredIssueId &&
        this.hoverIssueId === hoveredIssueId
      )
    ) {
      this.actualizarAnclaPopup?.(hoveredIssueId, {
        ...anchor,
        rectIndex: anchorRectIndex,
      });
    }
    if (hoveredIssueId === this.hoverIssueId) {
      return;
    }

    const previousIssueId = this.hoverIssueId;
    if (previousIssueId) {
      this.manejarSalidaHoverIssue(previousIssueId, null);
    }
    if (hoveredIssueId) {
      this.manejarEntradaHoverIssue(hoveredIssueId, anchor);
    }
  },

  manejarClickMarcador(issueId, event) {
    this.cancelarProgramacionPopup();
    this.actualizarAnclaPopup?.(issueId, this.obtenerAnclaPuntero(event));
    this.hoverIssueId = issueId;
    this.hoverPopupIssueId = issueId;
    this.pinnedIssueId = issueId;
    obtenerAccionesReviewer().establecerIssueActivo(issueId, {
      mostrarPopup: true,
      fijarPopup: true,
    });
  },
};
