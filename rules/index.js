// Inicializa el array global de reglas
if (typeof window.docsReviewerRules === 'undefined') {
  window.docsReviewerRules = [];
}

// Utilidades compartidas para normalizacion de acentos
const accentInsensitiveUtils = {
  accentInsensitiveMap: {
    a: "[aá]",
    e: "[eé]",
    i: "[ií]",
    o: "[oó]",
    u: "[uúü]",
    n: "[nñ]",
  },

  escapeRegexChar(char) {
    return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  normalizeAccentChar(char) {
    return char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },

  buildAccentInsensitivePattern(text) {
    return Array.from(text)
      .map((char) => {
        const lowerChar = this.normalizeAccentChar(char).toLocaleLowerCase();
        return this.accentInsensitiveMap[lowerChar] || this.escapeRegexChar(char);
      })
      .join("");
  }
};

if (typeof window.accentInsensitiveUtils === 'undefined') {
  window.accentInsensitiveUtils = accentInsensitiveUtils;
}
