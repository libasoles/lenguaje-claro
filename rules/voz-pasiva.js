const vozPasivaRule = {
  id: 'voz-pasiva',
  nombre: 'Voz pasiva',
  descripcion: 'Reemplaza construcciones pasivas por voz activa más directa',
  color: '#f39c12', // Naranja

  detectar(texto) {
    const matches = [];

    // Patrón: "fue/fueron/es/son + verbo + por"
    // Ejemplo: "Fue interpuesto el recurso por la representación"
    const regex = /(fue|fueron|es|son)\s+(\w+(?:ado|ada|ados|adas|ido|ida|idos|idas))\s+por\s+/gi;
    let match;

    while ((match = regex.exec(texto)) !== null) {
      const inicio = match.index;
      const fin = match.index + match[0].length;

      // Extraer un poco más de contexto para la sugerencia
      const contextoAntes = texto.substring(Math.max(0, inicio - 20), inicio).trim();
      const contextoDepues = texto.substring(fin, Math.min(texto.length, fin + 30)).trim();

      matches.push({
        id: `${this.id}-${matches.length}`,
        inicio: inicio,
        fin: fin,
        textoOriginal: match[0].trim(),
        sugerencia: '(considera usar voz activa)',
        regla: this.id,
        descripcion: `Voz pasiva detectada. Considera reestructurar en voz activa.`
      });
    }

    return matches;
  }
};

// Registrar la regla en el objeto global
if (typeof window.docsReviewerRules === 'undefined') {
  window.docsReviewerRules = [];
}
window.docsReviewerRules.push(vozPasivaRule);
