const queismoRule = {
  id: 'queismo',
  nombre: 'Queísmo',
  descripcion: 'Evita encadenar múltiples "que" en la misma oración',
  color: '#f1c40f', // Amarillo

  detectar(texto) {
    const matches = [];

    // Dividir por puntos (oraciones)
    const oraciones = texto.split(/[.!?]+/);

    oraciones.forEach((oracion, indiceOracion) => {
      // Buscar 3 o más "que" en la misma oración
      const regex = /que/gi;
      const queMatches = [];

      let match;
      while ((match = regex.exec(oracion)) !== null) {
        queMatches.push({
          index: match.index,
          length: match[0].length
        });
      }

      // Si hay 3 o más "que", reportar la oración como problema
      if (queMatches.length >= 3) {
        // Calcular el índice en el texto completo
        let inicioEnTextoCompleto = 0;
        for (let i = 0; i < indiceOracion; i++) {
          inicioEnTextoCompleto += oraciones[i].length + 1; // +1 por el punto
        }

        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: inicioEnTextoCompleto,
          fin: inicioEnTextoCompleto + oracion.length,
          textoOriginal: oracion.trim(),
          sugerencia: '(simplifica dividiendo en múltiples oraciones)',
          regla: this.id,
          descripcion: `Se detectan ${queMatches.length} instancias de "que" en la oración. Considera dividirla.`
        });
      }
    });

    return matches;
  }
};

// Registrar la regla en el objeto global
if (typeof window.docsReviewerRules === 'undefined') {
  window.docsReviewerRules = [];
}
window.docsReviewerRules.push(queismoRule);
