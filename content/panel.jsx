import { DocsReader } from "./reader.js";
import { DocsRuntime } from "./runtime.js";
import { obtenerAccionesReviewer } from "./reviewer-actions.js";
import { rules } from "../rules/index.js";

export const DocsPanel = {
  /**
   * Elemento raíz del panel flotante (contenedor principal del panel)
   */
  panelElement: null,
  /**
   * Contenedor donde se renderizan los issues detectados
   */
  issuesContainer: null,
  /**
   * Elemento de la barra de herramientas de ordenamiento
   */
  toolbarElement: null,
  /**
   * Mapa de issueId a su elemento DOM correspondiente en el panel
   */
  issueElements: new Map(),
  /**
   * ID del issue actualmente activo o enfocado en el panel
   */
  activeIssueId: null,
  /**
   * Indica si el panel está visible en pantalla
   */
  isVisible: false,
  sortMode: "posicion",
  /**
   * Matches (issues) ya detectados en el documento.
   * Se usa para refrescar la lista de issues al cambiar el modo de ordenamiento.
   * @type {Array<Object>}
   */
  currentMatches: [],

  async inyectar() {
    try {
      await DocsReader.esperarDocumentoListo();

      const logoURL = DocsRuntime.obtenerURL("assets/icons/logo.svg");
      this.logoURL = logoURL;
      const logoImg = logoURL ? (
        <img src={logoURL} className="docs-reviewer-logo" alt="" />
      ) : null;

      const panelJSX = (
        <div id="docs-reviewer-panel" className="docs-reviewer-panel">
          <div className="docs-reviewer-header">
            <a
              className="docs-reviewer-title"
              href="https://extensionlenguajeclaro.com.ar/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {logoImg}
              <h3>Lenguaje claro</h3>
            </a>
            <div className="docs-reviewer-header-buttons">
              <button
                id="docs-reviewer-reanalizar"
                className="docs-reviewer-reanalyze"
                title="Re-analizar documento"
                onClick={() => obtenerAccionesReviewer().analizarDocumento()}
              >
                <svg
                  className="docs-reviewer-reanalyze-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path
                    d="M21 12a9 9 0 1 1-2.64-6.36"
                    stroke="currentColor"
                    strokeWidth={2}
                    fill="none"
                  />
                  <path
                    d="M21 3v6h-6"
                    stroke="currentColor"
                    strokeWidth={2}
                    fill="none"
                  />
                </svg>
                <span className="docs-reviewer-sr-only">↺</span>
              </button>
              <button
                id="docs-reviewer-close"
                className="docs-reviewer-close"
                onClick={() => this.alternarVisibilidad()}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="docs-reviewer-content">
            <div
              id="docs-reviewer-toolbar"
              className="docs-reviewer-sort-toolbar"
            >
              <button
                id="docs-reviewer-sort-posicion"
                className="docs-reviewer-sort-btn docs-reviewer-sort-btn--active"
                onClick={() => {
                  this.sortMode = "posicion";
                  this.actualizarIssues(this.currentMatches);
                }}
              >
                Por aparición
              </button>
              <button
                id="docs-reviewer-sort-regla"
                className="docs-reviewer-sort-btn"
                onClick={() => {
                  this.sortMode = "regla";
                  this.actualizarIssues(this.currentMatches);
                }}
              >
                Por regla
              </button>
            </div>
            <div id="docs-reviewer-issues" className="docs-reviewer-issues">
              {this._crearEsqueleto()}
            </div>
          </div>
        </div>
      );

      this.panelElement = panelJSX;
      const host = await this._esperarHost();
      if (host !== document.body) {
        const pos = getComputedStyle(host).position;
        if (pos === "static") host.style.position = "relative";
      }
      host.appendChild(this.panelElement);
      this.panelElement.style.display = "none";

      this.issuesContainer = this.panelElement.querySelector(
        "#docs-reviewer-issues",
      );
      this.toolbarElement = this.panelElement.querySelector(
        "#docs-reviewer-toolbar",
      );
    } catch (e) {
      console.error("Error al inyectar el panel:", e);
    }
  },

  async _esperarHost(timeoutMs = 10000) {
    const selector = ".kix-appview-editor-container";
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise((r) => setTimeout(r, 100));
    }
    console.warn(
      `[Docs Reviewer] No se encontró ${selector}; usando document.body`,
    );
    return document.body;
  },

  mostrarCargando() {
    this.activeIssueId = null;
    this.issueElements.clear();

    if (this.issuesContainer) {
      this._renderizarIssues(this._crearEsqueleto());
    }
  },

  _renderizarIssues(contenido) {
    if (!this.issuesContainer) return;

    const nodos = Array.isArray(contenido) ? contenido : [contenido];
    this.issuesContainer.replaceChildren(...nodos.filter(Boolean));
  },

  _crearEsqueleto() {
    const crearTarjeta = () => (
      <div className="docs-reviewer-skeleton-card">
        <div className="docs-reviewer-skeleton docs-reviewer-skeleton-badge" />
        <div
          className="docs-reviewer-skeleton docs-reviewer-skeleton-line"
          style={{ width: "90%" }}
        />
        <div
          className="docs-reviewer-skeleton docs-reviewer-skeleton-line"
          style={{ width: "70%" }}
        />
        <div
          className="docs-reviewer-skeleton docs-reviewer-skeleton-line docs-reviewer-skeleton-line--suggestion"
          style={{ width: "80%" }}
        />
        <div className="docs-reviewer-skeleton docs-reviewer-skeleton-btn" />
      </div>
    );

    return (
      <div className="docs-reviewer-skeleton-list">
        {[crearTarjeta(), crearTarjeta(), crearTarjeta()]}
      </div>
    );
  },

  _crearMensajeSinIssues() {
    return (
      <p className="docs-reviewer-placeholder docs-reviewer-placeholder-success">
        ✓ No se encontraron problemas
      </p>
    );
  },

  mostrarError(mensaje) {
    this.activeIssueId = null;
    this.issueElements.clear();

    if (this.issuesContainer) {
      this._renderizarIssues(
        <p className="docs-reviewer-placeholder docs-reviewer-error">
          {mensaje}
        </p>,
      );
    }
  },

  mostrarErrorAuth() {
    if (!this.issuesContainer) return;

    this.activeIssueId = null;
    this.issueElements.clear();

    this._renderizarIssues(
      <div className="docs-reviewer-auth-error">
        <p className="docs-reviewer-placeholder docs-reviewer-error">
          Sin acceso al documento. Concede permisos de lectura y edición.
        </p>
        <button
          id="docs-reviewer-auth-btn"
          className="docs-reviewer-auth-button"
          onClick={() =>
            obtenerAccionesReviewer().analizarDocumento({ interactive: true })
          }
        >
          Conceder
        </button>
      </div>,
    );
  },

  mostrarToastError(mensaje, duracionMs = 4000) {
    const existing = document.getElementById("docs-reviewer-toast");
    if (existing) existing.remove();

    const toastNode = (
      <div
        id="docs-reviewer-toast"
        style={{
          position: "fixed",
          bottom: "24px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#c0392b",
          color: "#fff",
          padding: "10px 18px",
          borderRadius: "6px",
          fontSize: "13px",
          zIndex: 2147483647,
          maxWidth: "360px",
          textAlign: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,.3)",
        }}
      >
        {mensaje}
      </div>
    );
    document.body.appendChild(toastNode);
    setTimeout(() => {
      toastNode.remove();
    }, duracionMs);
  },

  mostrarErrorExtensionRecargada() {
    this.mostrarError(
      DocsRuntime.INVALIDATED_CONTEXT_MESSAGE ||
        "La extensión se actualizó. Recargá la página para continuar.",
    );
  },

  _actualizarToolbar() {
    const btnPosicion = document.getElementById("docs-reviewer-sort-posicion");
    const btnRegla = document.getElementById("docs-reviewer-sort-regla");
    if (btnPosicion)
      btnPosicion.classList.toggle(
        "docs-reviewer-sort-btn--active",
        this.sortMode === "posicion",
      );
    if (btnRegla)
      btnRegla.classList.toggle(
        "docs-reviewer-sort-btn--active",
        this.sortMode === "regla",
      );
  },

  actualizarIssues(allMatches) {
    if (!this.issuesContainer) return;

    this.currentMatches = allMatches;
    this.issueElements.clear();
    this.activeIssueId = null;
    this._actualizarToolbar();

    if (allMatches.length === 0) {
      this._renderizarIssues(this._crearMensajeSinIssues());
      return;
    }

    if (this.sortMode === "posicion") {
      const issuesList = allMatches.map((issue) => {
        const issueNode = this._crearElementoIssue(issue, { showRegla: true });
        this.issueElements.set(issue.id, issueNode);
        return issueNode;
      });
      this._renderizarIssues(issuesList);
      return;
    }

    const porRegla = {};
    allMatches.forEach((match) => {
      if (!porRegla[match.regla]) {
        porRegla[match.regla] = [];
      }
      porRegla[match.regla].push(match);
    });

    const sections = [];
    rules.forEach((regla) => {
      const issues = porRegla[regla.id] || [];
      if (!issues.length) return;

      const sectionTitleStyle = regla.color
        ? { "--docs-reviewer-rule-color": regla.color }
        : undefined;

      sections.push(
        <div
          className="docs-reviewer-section-title"
          data-regla={regla.id}
          style={sectionTitleStyle}
        >
          {regla.nombre}
        </div>,
      );

      const issueNodes = issues.map((issue) => {
        const issueNode = this._crearElementoIssue(issue, { showRegla: false });
        this.issueElements.set(issue.id, issueNode);
        return issueNode;
      });

      sections.push(
        <div className="docs-reviewer-issue-section">{issueNodes}</div>,
      );
    });

    this._renderizarIssues(sections);
  },

  /**
   * Elimina visualmente un issue del panel y del mapa, sin refrescar toda la lista.
   * No borra ni recrea el resto del panel.
   */
  eliminarIssueDePanel(issueId) {
    const el = this.issueElements.get(issueId);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
      this.issueElements.delete(issueId);
    }
    // Si no quedan issues, mostrar mensaje vacío
    if (this.issueElements.size === 0 && this.issuesContainer) {
      this._renderizarIssues(this._crearMensajeSinIssues());
    }
  },

  _crearOriginalIssue(issue) {
    const textoOriginal = String(issue.textoOriginal ?? "");

    if (issue.regla === "queismo") {
      return (
        <div className="docs-reviewer-issue-original">
          {textoOriginal
            .split(/(que)/gi)
            .map((parte) =>
              parte.toLowerCase() === "que" ? (
                <span className="docs-reviewer-inline-mark">{parte}</span>
              ) : (
                parte
              ),
            )}
        </div>
      );
    }

    return (
      <div className="docs-reviewer-issue-original">
        <span className="docs-reviewer-inline-mark">{textoOriginal}</span>
      </div>
    );
  },

  _crearElementoIssue(issue, { showRegla }) {
    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    const hasMultipleSugerencias =
      Array.isArray(issue.sugerencias) && issue.sugerencias.length > 1;
    const canApplyFromPanel =
      Array.isArray(issue.sugerencias) &&
      issue.sugerencias.length === 1 &&
      issue.aplicable !== false &&
      !PLACEHOLDER_SUGGESTIONS.includes(issue.sugerencias[0]);

    const renderSugerencias = () => {
      if (!hasMultipleSugerencias) return null;
      return (
        <div className="docs-reviewer-issue-button-group">
          {issue.sugerencias.map((s) => (
            <button
              className="docs-reviewer-issue-button docs-reviewer-issue-button-option"
              onClick={(e) => {
                e.stopPropagation();
                obtenerAccionesReviewer().aplicarCorreccion(issue.id, s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      );
    };

    const renderBotonUnico = () => {
      if (hasMultipleSugerencias || issue.aplicable === false) return null;
      return (
        <button
          className="docs-reviewer-issue-button"
          onClick={(e) => {
            e.stopPropagation();
            obtenerAccionesReviewer().aplicarCorreccion(
              issue.id,
              issue.sugerencias?.[0],
            );
          }}
        >
          {canApplyFromPanel ? "Aplicar cambio" : "Ver en documento"}
        </button>
      );
    };

    const renderSugerencia = () => {
      if (
        hasMultipleSugerencias ||
        !Array.isArray(issue.sugerencias) ||
        !issue.sugerencias.length
      )
        return null;
      const unica = issue.sugerencias[0];
      if (canApplyFromPanel) {
        return (
          <div
            className="docs-reviewer-issue-sugerencia"
            dangerouslySetInnerHTML={{ __html: unica }}
          />
        );
      } else if (issue.aplicable === false) {
        return (
          <div
            className="docs-reviewer-issue-hint"
            dangerouslySetInnerHTML={{ __html: unica }}
          />
        );
      }
      return null;
    };

    const style = issue.color
      ? { "--docs-reviewer-rule-color": issue.color }
      : undefined;

    return (
      <div
        className="docs-reviewer-issue"
        data-regla={issue.regla}
        data-issue-id={issue.id}
        style={style}
        onClick={() => obtenerAccionesReviewer().enfocarIssue(issue.id)}
      >
        {showRegla && (
          <div className="docs-reviewer-issue-regla">
            <span className="docs-reviewer-issue-color">
              {issue.reglaNombre}
            </span>
          </div>
        )}
        {this._crearOriginalIssue(issue)}
        {renderSugerencia()}
        {renderSugerencias()}
        {renderBotonUnico()}
      </div>
    );
  },

  establecerIssueActivo(issueId, options = {}) {
    if (this.activeIssueId && this.issueElements.has(this.activeIssueId)) {
      this.issueElements
        .get(this.activeIssueId)
        .classList.remove("docs-reviewer-issue-active");
    }

    this.activeIssueId = issueId;

    if (issueId && this.issueElements.has(issueId)) {
      const issueElement = this.issueElements.get(issueId);
      issueElement.classList.add("docs-reviewer-issue-active");

      if (options.desplazarPanel) {
        const behavior = options.desplazarPanelInstantaneo ? "auto" : "smooth";
        if (options.desplazarPanelAlInicio) {
          this._desplazarIssueAlInicio(issueElement, behavior);
        } else {
          issueElement.scrollIntoView({ block: "nearest", behavior });
        }
      }

      if (options.destacar) {
        issueElement.classList.remove("docs-reviewer-issue-flash");
        // Force reflow so the animation restarts if re-triggered.
        void issueElement.offsetWidth;
        issueElement.classList.add("docs-reviewer-issue-flash");
        if (this._flashTimer) clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => {
          issueElement.classList.remove("docs-reviewer-issue-flash");
          this._flashTimer = null;
        }, 3000);
      }
    }
  },

  _desplazarIssueAlInicio(issueElement, behavior) {
    const scrollContainer = this.panelElement?.querySelector(
      ".docs-reviewer-content",
    );
    if (!scrollContainer) {
      issueElement.scrollIntoView({ block: "start", behavior });
      return;
    }
    const toolbar = scrollContainer.querySelector(
      ".docs-reviewer-sort-toolbar",
    );
    let offsetSticky = toolbar ? toolbar.getBoundingClientRect().height : 0;
    const sectionTitle = issueElement.closest(
      ".docs-reviewer-issue-section",
    )?.previousElementSibling;
    if (
      sectionTitle &&
      sectionTitle.classList.contains("docs-reviewer-section-title")
    ) {
      offsetSticky += sectionTitle.getBoundingClientRect().height;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const issueRect = issueElement.getBoundingClientRect();
    const delta = issueRect.top - containerRect.top - offsetSticky - 8;
    scrollContainer.scrollBy({ top: delta, behavior });
  },

  enfocarIssue(issueId, options = {}) {
    const issueElement = this.issueElements.get(issueId);
    if (!issueElement) return false;

    this.establecerIssueActivo(issueId, {
      desplazarPanel: true,
      desplazarPanelAlInicio: options.desplazarPanelAlInicio,
      destacar: options.destacar,
    });
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
