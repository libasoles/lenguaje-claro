const arcaismosRule = {
  id: "arcaismos",
  nombre: "Arcaísmo innecesario",
  descripcion: "Sustituye términos obsoletos por lenguaje actual",
  color: "#f1c40f", // Amarillo

  getWordCaseStyle(word) {
    if (!word) return "lower";

    if (word === word.toLocaleUpperCase()) return "upper";
    if (word === word.toLocaleLowerCase()) return "lower";

    const firstChar = word.charAt(0);
    const rest = word.slice(1);

    if (
      firstChar === firstChar.toLocaleUpperCase() &&
      rest === rest.toLocaleLowerCase()
    ) {
      return "capitalized";
    }

    return "mixed";
  },

  applyWordCaseStyle(word, style) {
    if (!word) return word;

    switch (style) {
      case "upper":
        return word.toLocaleUpperCase();
      case "capitalized":
        return (
          word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()
        );
      case "lower":
        return word.toLocaleLowerCase();
      default:
        return word;
    }
  },

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
  },

  mantenerCase(original, sugerencia) {
    if (!original || !sugerencia) return sugerencia;

    if (original === original.toLocaleUpperCase()) {
      return sugerencia.toLocaleUpperCase();
    }

    if (original === original.toLocaleLowerCase()) {
      return sugerencia.toLocaleLowerCase();
    }

    const originalWords = original.match(/\S+/g) || [];
    if (
      originalWords.length > 0 &&
      originalWords.every(
        (word) =>
          this.getWordCaseStyle(word) === "capitalized" ||
          this.getWordCaseStyle(word) === "lower",
      ) &&
      this.getWordCaseStyle(originalWords[0]) === "capitalized"
    ) {
      const suggestionWords = sugerencia.split(/(\s+)/);
      let wordIndex = 0;

      return suggestionWords
        .map((segment) => {
          if (!segment.trim()) return segment;

          const sourceWord = originalWords[wordIndex] || originalWords.at(-1);
          const style = this.getWordCaseStyle(sourceWord);
          wordIndex += 1;
          return this.applyWordCaseStyle(segment, style);
        })
        .join("");
    }

    if (
      this.getWordCaseStyle(originalWords[0]) === "capitalized" &&
      originalWords.slice(1).every(
        (word) => this.getWordCaseStyle(word) === "lower",
      )
    ) {
      return (
        sugerencia.charAt(0).toLocaleUpperCase() +
        sugerencia.slice(1).toLocaleLowerCase()
      );
    }

    return sugerencia;
  },

  // Diccionario de arcaísmos
  diccionario: [
    { original: "in fine", sugerencia: "al final", palabrasClaves: "in fine" },
    {
      original: "a sensu contrario",
      sugerencia: "en sentido contrario",
      palabrasClaves: "a sensu contrario",
    },
    {
      original: "viene en decidir",
      sugerencia: "se decide",
      palabrasClaves: "viene en decidir",
    },
    {
      original: "otrosí digo",
      sugerencia: "además solicito",
      palabrasClaves: "otrosí digo",
    },
    {
      original: "susodicho",
      sugerencia: "mencionado",
      palabrasClaves: "susodicho",
    },
    {
      original: "infraescrito",
      sugerencia: "quien firma",
      palabrasClaves: "infraescrito",
    },
    {
      original: "fehaciente",
      sugerencia: "comprobable",
      palabrasClaves: "fehaciente",
    },
    { original: "incoar", sugerencia: "iniciar", palabrasClaves: "incoar" },
    { original: "adverar", sugerencia: "acreditar", palabrasClaves: "adverar" },
    { original: "dirimir", sugerencia: "resolver", palabrasClaves: "dirimir" },
    {
      original: "decaer en su derecho",
      sugerencia: "perder su derecho",
      palabrasClaves: "decaer en su derecho",
    },
    {
      original: "sírvase proveer",
      sugerencia: "disponga",
      palabrasClaves: "sírvase proveer",
    },
    {
      original: "tenor literal",
      sugerencia: "texto literal",
      palabrasClaves: "tenor literal",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      // Case-insensitive regex con word boundaries
      const pattern = this.buildAccentInsensitivePattern(item.palabrasClaves);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        const sugerencia = this.mantenerCase(match[0], item.sugerencia);
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por "${sugerencia}"`,
        });
      }
    });

    return matches;
  },
};

// Registrar la regla en el objeto global
if (typeof window.docsReviewerRules === "undefined") {
  window.docsReviewerRules = [];
}
window.docsReviewerRules.push(arcaismosRule);
