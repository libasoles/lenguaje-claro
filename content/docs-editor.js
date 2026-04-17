// docs-editor.js - Puente desde el isolated world al kix-bridge (main world).
// Observa cuándo el bridge captura la instancia del editor y expone una API
// que eventualmente aplicará reemplazos a través del pipeline nativo de Docs.
//
// Durante el spike inicial, aplicarReemplazo lanza un error: la migración
// desde REST batchUpdate ocurrirá cuando el spike identifique el método
// interno del editor que aplica cambios undoable.

const DocsEditor = {
  isBridgeReady: false,
  _bridgeSource: null,

  init() {
    document.addEventListener('docs-reviewer-kix-ready', (event) => {
      const detail = event.detail || {};
      this.isBridgeReady = Boolean(detail.source) || Boolean(detail.captured);
      this._bridgeSource = detail.source || this._bridgeSource;
      console.log(
        '[Docs Reviewer][docs-editor] bridge status:',
        this.isBridgeReady ? `ready (via ${this._bridgeSource})` : 'not captured yet',
      );
    });

    // Sondear al bridge por si ya capturó la instancia antes de que cargara
    // este script (poco probable dado el orden, pero defensivo).
    document.dispatchEvent(new CustomEvent('docs-reviewer-kix-query'));
  },

  async aplicarReemplazo(/* { inicio, fin, textoReemplazo } */) {
    throw new Error(
      'DocsEditor.aplicarReemplazo todavía no está implementado — ' +
        'pendiente identificar el método del editor kix (ver plan).',
    );
  },
};

DocsEditor.init();
window.DocsEditor = DocsEditor;
