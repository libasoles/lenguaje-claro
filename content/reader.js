const DocsReader = {
  // Extrae todo el texto del documento Google Docs
  leerTextoCompleto() {
    const paragrafos = document.querySelectorAll('.kix-paragraphrenderer');
    const textoCompleto = Array.from(paragrafos)
      .map(p => p.innerText)
      .join('\n');
    return textoCompleto;
  },

  // Retorna un array con información detallada de cada párrafo
  leerParagrafos() {
    const paragrafos = document.querySelectorAll('.kix-paragraphrenderer');
    return Array.from(paragrafos).map((elemento, indice) => ({
      indice: indice,
      elemento: elemento,
      texto: elemento.innerText,
      html: elemento.innerHTML
    }));
  },

  // Busca un párrafo específico basado en su texto
  buscarParrafo(textoPartial) {
    const paragrafos = document.querySelectorAll('.kix-paragraphrenderer');
    return Array.from(paragrafos).find(p =>
      p.innerText.includes(textoPartial)
    );
  },

  // Espera a que Google Docs cargue completamente
  esperarDocumentoListo(timeout = 5000) {
    return new Promise((resolve) => {
      const checkDocsReady = () => {
        const appView = document.querySelector('.kix-appview');
        if (appView && document.querySelectorAll('.kix-paragraphrenderer').length > 0) {
          resolve();
        } else {
          setTimeout(checkDocsReady, 100);
        }
      };

      setTimeout(() => resolve(), timeout); // Fallback después de timeout
      checkDocsReady();
    });
  }
};
