const DocsPanel = {
  panelElement: null,
  issuesContainer: null,
  isVisible: true,

  // Inyecta el panel en la página
  async inyectar() {
    try {
      // Esperar a que el documento esté listo
      await DocsReader.esperarDocumentoListo();

      // Obtener el HTML del panel (está en el atributo data del manifest)
      const panelHTML = `
        <div id="docs-reviewer-panel" class="docs-reviewer-panel">
          <div class="docs-reviewer-header">
            <h3>Revisor de Escritura</h3>
            <button id="docs-reviewer-close" class="docs-reviewer-close">✕</button>
          </div>
          <div class="docs-reviewer-content">
            <div id="docs-reviewer-issues" class="docs-reviewer-issues">
              <p class="docs-reviewer-placeholder">Analizando documento...</p>
            </div>
          </div>
        </div>
      `;

      // Crear y añadir el panel al DOM
      const wrapper = document.createElement('div');
      wrapper.innerHTML = panelHTML;
      this.panelElement = wrapper.querySelector('#docs-reviewer-panel');
      document.body.appendChild(this.panelElement);

      // Referencias útiles
      this.issuesContainer = document.getElementById('docs-reviewer-issues');

      // Agregar event listeners
      this.agregarEventListeners();
    } catch (e) {
      console.error('Error al inyectar el panel:', e);
    }
  },

  // Agrega los event listeners
  agregarEventListeners() {
    const closeBtn = document.getElementById('docs-reviewer-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.alternarVisibilidad());
    }
  },

  // Actualiza el contenido del panel con los problemas encontrados
  actualizarIssues(allMatches) {
    if (!this.issuesContainer) return;

    // Limpiar contenido anterior
    this.issuesContainer.innerHTML = '';

    if (allMatches.length === 0) {
      this.issuesContainer.innerHTML = '<p class="docs-reviewer-placeholder">✓ No se encontraron problemas</p>';
      return;
    }

    // Agrupar matches por regla
    const porRegla = {};
    allMatches.forEach(match => {
      if (!porRegla[match.regla]) {
        porRegla[match.regla] = [];
      }
      porRegla[match.regla].push(match);
    });

    // Renderizar cada grupo de problemas
    window.docsReviewerRules.forEach(regla => {
      const issues = porRegla[regla.id] || [];

      if (issues.length === 0) return;

      // Crear una sección para cada regla
      const sectionDiv = document.createElement('div');
      sectionDiv.className = 'docs-reviewer-issue-section';

      issues.forEach((issue, idx) => {
        const issueDiv = document.createElement('div');
        issueDiv.className = 'docs-reviewer-issue';
        issueDiv.setAttribute('data-regla', issue.regla);

        const reglaElement = document.createElement('div');
        reglaElement.className = 'docs-reviewer-issue-regla';
        reglaElement.innerHTML = `<span class="docs-reviewer-issue-color">${regla.nombre}</span>`;

        const textoElement = document.createElement('div');
        textoElement.className = 'docs-reviewer-issue-texto';
        textoElement.textContent = `${issue.descripcion} (${idx + 1}/${issues.length})`;

        const originalElement = document.createElement('div');
        originalElement.className = 'docs-reviewer-issue-original';
        originalElement.textContent = issue.textoOriginal;

        let suggestionHTML = '';
        if (issue.sugerencia && issue.sugerencia !== '(simplifica dividiendo en múltiples oraciones)' && issue.sugerencia !== '(considera usar voz activa)') {
          const suggerencionElement = document.createElement('div');
          suggerencionElement.className = 'docs-reviewer-issue-sugerencia';
          suggerencionElement.innerHTML = `<strong>Sugerencia:</strong> ${issue.sugerencia}`;
          suggestionHTML = suggerencionElement.outerHTML;
        }

        const buttonElement = document.createElement('button');
        buttonElement.className = 'docs-reviewer-issue-button';
        buttonElement.textContent = issue.regla === 'arcaismos' ? 'Aplicar cambio' : 'Ver en documento';

        buttonElement.addEventListener('click', () => {
          this.aplicarCorreccion(issue);
        });

        issueDiv.appendChild(reglaElement);
        issueDiv.appendChild(textoElement);
        issueDiv.appendChild(originalElement);
        if (suggestionHTML) {
          issueDiv.innerHTML += suggestionHTML;
        }
        issueDiv.appendChild(buttonElement);

        sectionDiv.appendChild(issueDiv);
      });

      this.issuesContainer.appendChild(sectionDiv);
    });
  },

  // Aplica la corrección al documento
  aplicarCorreccion(issue) {
    // Para arcaísmos, hacer un find & replace simple
    if (issue.regla === 'arcaismos' && issue.sugerencia) {
      // Enfocar el documento
      document.querySelector('[role="document"]')?.focus() || document.body.focus();

      // Usar Ctrl+H para abrir Find & Replace
      const event = new KeyboardEvent('keydown', {
        key: 'h',
        code: 'KeyH',
        ctrlKey: true,
        bubbles: true
      });
      document.dispatchEvent(event);

      // Copiar el texto original al clipboard
      navigator.clipboard.writeText(issue.textoOriginal).then(() => {
        console.log('Texto copiado al clipboard:', issue.textoOriginal);
        alert(`Abierto Find & Replace.\n\nTexto a buscar (copiado): "${issue.textoOriginal}"\nReemplazar con: "${issue.sugerencia}"`);
      });
    } else {
      // Para otros tipos, solo resaltar en el documento
      alert(`Problema: ${issue.descripcion}\n\nTexto: "${issue.textoOriginal}"`);
    }
  },

  // Alterna la visibilidad del panel
  alternarVisibilidad() {
    if (this.panelElement) {
      this.isVisible = !this.isVisible;
      this.panelElement.style.display = this.isVisible ? 'flex' : 'none';
    }
  },

  // Muestra el panel
  mostrar() {
    if (this.panelElement) {
      this.panelElement.style.display = 'flex';
      this.isVisible = true;
    }
  },

  // Oculta el panel
  ocultar() {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
      this.isVisible = false;
    }
  }
};
