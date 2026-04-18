import { DocsReader } from "./reader.js";
import { DocsRuntime } from "./runtime.js";
import { getReviewerActions } from "./reviewer-actions.js";
import { rules } from "../rules/index.js";

export const DocsPanel = {
  panelElement: null,
  issuesContainer: null,
  issueElements: new Map(),
  activeIssueId: null,
  isVisible: true,
  sortMode: "posicion",
  lastMatches: [],

  async inyectar() {
    try {
      await DocsReader.esperarDocumentoListo();

      const logoURL = DocsRuntime.getURL("assets/icons/logo.svg");
      const logoMarkup = logoURL
        ? `<img src="${logoURL}" class="docs-reviewer-logo" alt="" />`
        : "";
      const panelHTML = `
        <div id="docs-reviewer-panel" class="docs-reviewer-panel">
          <div class="docs-reviewer-header">
            <div class="docs-reviewer-title">
              ${logoMarkup}
              <h3>Lenguaje claro</h3>
            </div>
            <div class="docs-reviewer-header-buttons">
              <button id="docs-reviewer-reanalizar" class="docs-reviewer-reanalyze" title="Re-analizar documento">
                <svg class="docs-reviewer-reanalyze-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
                <span class="docs-reviewer-sr-only">↺</span>
              </button>
              <button id="docs-reviewer-close" class="docs-reviewer-close">✕</button>
            </div>
          </div>
          <div class="docs-reviewer-content">
            <div id="docs-reviewer-issues" class="docs-reviewer-issues">
              <p class="docs-reviewer-placeholder">Analizando documento...</p>
            </div>
          </div>
        </div>
      `;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = panelHTML;
      this.panelElement = wrapper.querySelector("#docs-reviewer-panel");
      document.body.appendChild(this.panelElement);

      this.issuesContainer = document.getElementById("docs-reviewer-issues");
      this.agregarEventListeners();
    } catch (e) {
      console.error("Error al inyectar el panel:", e);
    }
  },

  agregarEventListeners() {
    const closeBtn = document.getElementById("docs-reviewer-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.alternarVisibilidad());
    }

    const reanalBtn = document.getElementById("docs-reviewer-reanalizar");
    if (reanalBtn) {
      reanalBtn.addEventListener("click", () =>
        getReviewerActions().analizarDocumento(),
      );
    }
  },

  mostrarCargando() {
    this.activeIssueId = null;
    this.issueElements.clear();

    if (this.issuesContainer) {
      this.issuesContainer.innerHTML =
        '<p class="docs-reviewer-placeholder">Analizando documento...</p>';
    }
  },

  mostrarError(mensaje) {
    this.activeIssueId = null;
    this.issueElements.clear();

    if (this.issuesContainer) {
      this.issuesContainer.innerHTML = `<p class="docs-reviewer-placeholder docs-reviewer-error">${mensaje}</p>`;
    }
  },

  mostrarErrorAuth() {
    if (!this.issuesContainer) return;

    this.activeIssueId = null;
    this.issueElements.clear();
    this.issuesContainer.innerHTML = `
      <div class="docs-reviewer-auth-error">
        <p class="docs-reviewer-placeholder docs-reviewer-error">Sin acceso al documento. Concede permisos de lectura y edición.</p>
        <button id="docs-reviewer-auth-btn" class="docs-reviewer-auth-button">Conceder</button>
      </div>
    `;

    document
      .getElementById("docs-reviewer-auth-btn")
      .addEventListener("click", () => {
        getReviewerActions().analizarDocumento({ interactive: true });
      });
  },

  mostrarToastError(mensaje, duracionMs = 4000) {
    const existing = document.getElementById("docs-reviewer-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "docs-reviewer-toast";
    toast.textContent = mensaje;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#c0392b",
      color: "#fff",
      padding: "10px 18px",
      borderRadius: "6px",
      fontSize: "13px",
      zIndex: "2147483647",
      maxWidth: "360px",
      textAlign: "center",
      boxShadow: "0 2px 8px rgba(0,0,0,.3)",
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duracionMs);
  },

  mostrarErrorExtensionRecargada() {
    this.mostrarError(
      DocsRuntime.INVALIDATED_CONTEXT_MESSAGE ||
        "La extensión se actualizó. Recargá la página para continuar.",
    );
  },

  actualizarIssues(allMatches) {
    if (!this.issuesContainer) return;

    this.lastMatches = allMatches;
    this.issuesContainer.innerHTML = "";
    this.issueElements.clear();
    this.activeIssueId = null;

    if (allMatches.length === 0) {
      this.issuesContainer.innerHTML =
        '<p class="docs-reviewer-placeholder docs-reviewer-placeholder-success">✓ No se encontraron problemas</p>';
      return;
    }

    // Sort toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "docs-reviewer-sort-toolbar";

    const btnRegla = document.createElement("button");
    btnRegla.className =
      "docs-reviewer-sort-btn" +
      (this.sortMode === "regla" ? " docs-reviewer-sort-btn--active" : "");
    btnRegla.textContent = "Por regla";
    btnRegla.addEventListener("click", () => {
      this.sortMode = "regla";
      this.actualizarIssues(this.lastMatches);
    });

    const btnPosicion = document.createElement("button");
    btnPosicion.className =
      "docs-reviewer-sort-btn" +
      (this.sortMode === "posicion" ? " docs-reviewer-sort-btn--active" : "");
    btnPosicion.textContent = "Por aparición";
    btnPosicion.addEventListener("click", () => {
      this.sortMode = "posicion";
      this.actualizarIssues(this.lastMatches);
    });

    toolbar.appendChild(btnPosicion);
    toolbar.appendChild(btnRegla);
    this.issuesContainer.appendChild(toolbar);

    if (this.sortMode === "posicion") {
      allMatches.forEach((issue) => {
        const issueDiv = this._crearIssueDiv(issue, { showRegla: true });
        this.issueElements.set(issue.id, issueDiv);
        this.issuesContainer.appendChild(issueDiv);
      });
    } else {
      const porRegla = {};
      allMatches.forEach((match) => {
        if (!porRegla[match.regla]) {
          porRegla[match.regla] = [];
        }
        porRegla[match.regla].push(match);
      });

      rules.forEach((regla) => {
        const issues = porRegla[regla.id] || [];
        if (!issues.length) return;

        const sectionTitle = document.createElement("div");
        sectionTitle.className = "docs-reviewer-section-title";
        sectionTitle.setAttribute("data-regla", regla.id);
        sectionTitle.textContent = regla.nombre;
        this.issuesContainer.appendChild(sectionTitle);

        const sectionDiv = document.createElement("div");
        sectionDiv.className = "docs-reviewer-issue-section";

        issues.forEach((issue) => {
          const issueDiv = this._crearIssueDiv(issue, { showRegla: false });
          this.issueElements.set(issue.id, issueDiv);
          sectionDiv.appendChild(issueDiv);
        });

        this.issuesContainer.appendChild(sectionDiv);
      });
    }
  },

  _crearIssueDiv(issue, { showRegla }) {
    const issueDiv = document.createElement("div");
    issueDiv.className = "docs-reviewer-issue";
    issueDiv.setAttribute("data-regla", issue.regla);
    issueDiv.setAttribute("data-issue-id", issue.id);

    if (showRegla) {
      const reglaElement = document.createElement("div");
      reglaElement.className = "docs-reviewer-issue-regla";
      reglaElement.innerHTML = `<span class="docs-reviewer-issue-color">${issue.reglaNombre}</span>`;
      issueDiv.appendChild(reglaElement);
    }

    const originalElement = document.createElement("div");
    originalElement.className = "docs-reviewer-issue-original";
    this.resaltarProblema(originalElement, issue.textoOriginal, issue.regla);
    issueDiv.appendChild(originalElement);

    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    const hasMultipleSugerencias =
      Array.isArray(issue.sugerencias) && issue.sugerencias.length > 1;
    const canApplyFromPanel =
      issue.sugerencia &&
      issue.aplicable !== false &&
      !PLACEHOLDER_SUGGESTIONS.includes(issue.sugerencia);

    if (!hasMultipleSugerencias && issue.sugerencia) {
      if (canApplyFromPanel) {
        const suggestionElement = document.createElement("div");
        suggestionElement.className = "docs-reviewer-issue-sugerencia";
        suggestionElement.innerHTML = issue.sugerencia;
        issueDiv.appendChild(suggestionElement);
      } else if (issue.aplicable === false) {
        const hintElement = document.createElement("div");
        hintElement.className = "docs-reviewer-issue-hint";
        hintElement.innerHTML = issue.sugerencia;
        issueDiv.appendChild(hintElement);
      }
    }

    if (hasMultipleSugerencias) {
      const buttonGroup = document.createElement("div");
      buttonGroup.className = "docs-reviewer-issue-button-group";
      issue.sugerencias.forEach((s) => {
        const btn = document.createElement("button");
        btn.className =
          "docs-reviewer-issue-button docs-reviewer-issue-button-option";
        btn.textContent = s;
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          getReviewerActions().aplicarCorreccion(issue.id, s);
        });
        buttonGroup.appendChild(btn);
      });
      issueDiv.appendChild(buttonGroup);
    } else if (issue.aplicable !== false) {
      const buttonElement = document.createElement("button");
      buttonElement.className = "docs-reviewer-issue-button";
      buttonElement.textContent = canApplyFromPanel
        ? "Aplicar cambio"
        : "Ver en documento";
      buttonElement.addEventListener("click", (event) => {
        event.stopPropagation();
        getReviewerActions().aplicarCorreccion(issue.id);
      });
      issueDiv.appendChild(buttonElement);
    }

    issueDiv.addEventListener("mouseenter", () => {
      getReviewerActions().setIssueActivo(issue.id, { showPopup: false });
    });
    issueDiv.addEventListener("mouseleave", () => {
      if (getReviewerActions().activeIssueId === issue.id) {
        getReviewerActions().limpiarIssueActivo({ preservePinnedPopup: true });
      }
    });
    issueDiv.addEventListener("click", () => {
      getReviewerActions().enfocarIssue(issue.id, {
        showPopup: true,
        pinPopup: true,
        scrollPanel: false,
      });
    });

    return issueDiv;
  },

  resaltarProblema(container, texto, regla) {
    if (regla === "queismo") {
      const partes = texto.split(/(que)/gi);
      partes.forEach((parte) => {
        if (parte.toLowerCase() === "que") {
          const mark = document.createElement("span");
          mark.className = "docs-reviewer-inline-mark";
          mark.textContent = parte;
          container.appendChild(mark);
        } else {
          container.appendChild(document.createTextNode(parte));
        }
      });
      return;
    }

    const mark = document.createElement("span");
    mark.className = "docs-reviewer-inline-mark";
    mark.textContent = texto;
    container.appendChild(mark);
  },

  setIssueActivo(issueId, options = {}) {
    if (this.activeIssueId && this.issueElements.has(this.activeIssueId)) {
      this.issueElements
        .get(this.activeIssueId)
        .classList.remove("docs-reviewer-issue-active");
    }

    this.activeIssueId = issueId;

    if (issueId && this.issueElements.has(issueId)) {
      const issueElement = this.issueElements.get(issueId);
      issueElement.classList.add("docs-reviewer-issue-active");

      if (options.scrollPanel) {
        issueElement.scrollIntoView({
          block: "nearest",
          behavior: options.instantPanelScroll ? "auto" : "smooth",
        });
      }
    }
  },

  enfocarIssue(issueId) {
    const issueElement = this.issueElements.get(issueId);
    if (!issueElement) return false;

    this.setIssueActivo(issueId, { scrollPanel: true });
    return true;
  },

  alternarVisibilidad() {
    if (this.panelElement) {
      this.isVisible = !this.isVisible;
      this.panelElement.style.display = this.isVisible ? "flex" : "none";
    }
  },

  mostrar() {
    if (this.panelElement) {
      this.panelElement.style.display = "flex";
      this.isVisible = true;
    }
  },

  ocultar() {
    if (this.panelElement) {
      this.panelElement.style.display = "none";
      this.isVisible = false;
    }
  },
};

export default DocsPanel;
