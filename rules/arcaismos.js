const arcaismosRule = {
  id: 'arcaismos',
  nombre: 'Arcaísmos innecesarios',
  descripcion: 'Sustituye términos obsoletos por lenguaje actual',
  color: '#e74c3c', // Rojo

  // Diccionario de arcaísmos
  diccionario: [
    { original: 'in fine', sugerencia: 'al final', palabrasClaves: 'in fine' },
    { original: 'a sensu contrario', sugerencia: 'en sentido contrario', palabrasClaves: 'a sensu contrario' },
    { original: 'viene en decidir', sugerencia: 'se decide', palabrasClaves: 'viene en decidir' },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach(item => {
      // Case-insensitive regex con word boundaries
      const regex = new RegExp(`\\b${item.palabrasClaves}\\b`, 'gi');
      let match;

      while ((match = regex.exec(texto)) !== null) {
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia: item.sugerencia,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por "${item.sugerencia}"`
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
window.docsReviewerRules.push(arcaismosRule);
