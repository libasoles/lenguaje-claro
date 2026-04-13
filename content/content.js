// Main content script - Orquesta todo el análisis y la detección de problemas

const DocsReviewer = {
  allMatches: [],
  mutationObserver: null,
  isInitialized: false,

  // Inicializa la extensión
  async init() {
    if (this.isInitialized) return;

    console.log('[Docs Reviewer] Iniciando...');

    // Esperar a que Google Docs cargue
    await DocsReader.esperarDocumentoListo();

    console.log('[Docs Reviewer] Google Docs listo');

    // Inyectar el panel
    await DocsPanel.inyectar();

    // Ejecutar análisis inicial
    this.analizarDocumento();

    // Configurar MutationObserver para re-analizar en cambios
    this.configurarMutationObserver();

    this.isInitialized = true;
    console.log('[Docs Reviewer] Inicialización completada');
  },

  // Analiza el documento y detecta todos los problemas
  analizarDocumento() {
    const textoCompleto = DocsReader.leerTextoCompleto();

    if (!textoCompleto) {
      console.log('[Docs Reviewer] Documento vacío');
      return;
    }

    console.log('[Docs Reviewer] Texto leído:', textoCompleto.substring(0, 100));
    console.log('[Docs Reviewer] Reglas disponibles:', window.docsReviewerRules ? window.docsReviewerRules.length : 0);

    // Ejecutar todas las reglas
    this.allMatches = [];

    if (window.docsReviewerRules && window.docsReviewerRules.length > 0) {
      window.docsReviewerRules.forEach(regla => {
        try {
          console.log(`[Docs Reviewer] Ejecutando regla: ${regla.id}`);
          const matches = regla.detectar(textoCompleto);
          console.log(`[Docs Reviewer] Regla ${regla.id} encontró ${matches.length} matches`);
          this.allMatches.push(...matches);
        } catch (e) {
          console.error(`[Docs Reviewer] Error en regla ${regla.id}:`, e);
        }
      });
    } else {
      console.warn('[Docs Reviewer] No hay reglas disponibles');
    }

    // Ordenar matches por posición
    this.allMatches.sort((a, b) => a.inicio - b.inicio);

    console.log(`[Docs Reviewer] ${this.allMatches.length} problemas detectados`);

    // Actualizar visualización
    DocsHighlighter.aplicarHighlights(this.allMatches);
    DocsPanel.actualizarIssues(this.allMatches);
  },

  // Configura MutationObserver para detectar cambios en el documento
  configurarMutationObserver() {
    // Observar cambios en los párrafos
    const target = document.querySelector('.kix-appview') || document.body;

    const config = {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: false,
      // Limitar observación a cambios significativos
    };

    this.mutationObserver = new MutationObserver(() => {
      // Debounce: esperar 500ms sin cambios antes de re-analizar
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        console.log('[Docs Reviewer] Re-analizando documento...');
        this.analizarDocumento();
      }, 500);
    });

    this.mutationObserver.observe(target, config);
  },

  // Detiene la observación
  stop() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
  }
};

// Iniciar cuando el documento esté completamente cargado
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    DocsReviewer.init();
  });
} else {
  DocsReviewer.init();
}

// Limpiar al descargar
window.addEventListener('beforeunload', () => {
  DocsReviewer.stop();
});
