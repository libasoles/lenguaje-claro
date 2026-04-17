const tecnicismosRule = {
  id: "tecnicismos",
  nombre: "Tecnicismo",
  descripcion: "Reemplaza términos técnicos por lenguaje llano",
  color: "#e67e22", // Naranja

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

  // Cada entrada puede tener `sugerencias` (array) para ofrecer múltiples opciones.
  // Si solo hay una opción, usar un array de un elemento igualmente.
  diccionario: [
    {
      original: "prestatario",
      sugerencias: ["persona que recibe un préstamo"],
      palabrasClaves: "prestatario",
    },
    {
      original: "expiración",
      sugerencias: ["vencimiento"],
      palabrasClaves: "expiración",
    },
    {
      original: "mora",
      sugerencias: ["retraso", "aplazamiento"],
      palabrasClaves: "mora",
    },
    {
      original: "enajenar",
      sugerencias: ["vender", "transmitir"],
      palabrasClaves: "enajenar",
    },
    {
      original: "enajenación",
      sugerencias: ["venta", "transmisión"],
      palabrasClaves: "enajenación",
    },
    {
      original: "empero",
      sugerencias: ["sin embargo"],
      palabrasClaves: "empero",
    },
    {
      original: "dilación",
      sugerencias: ["demora"],
      palabrasClaves: "dilación",
    },
    {
      original: "per cápita",
      sugerencias: ["por persona"],
      palabrasClaves: "per cápita",
    },
    {
      original: "cláusula penal",
      sugerencias: ["penalidad por incumplimiento"],
      palabrasClaves: "cláusula penal",
    },
    {
      original: "acreedor",
      sugerencias: ["quien presta el dinero", "quien tiene el derecho a cobrar"],
      palabrasClaves: "acreedor",
    },
    {
      original: "deudor",
      sugerencias: ["quien debe el dinero", "quien tiene la obligación de pagar"],
      palabrasClaves: "deudor",
    },
    {
      original: "rescisión",
      sugerencias: ["cancelación", "terminación"],
      palabrasClaves: "rescisión",
    },
    {
      original: "resolución",
      sugerencias: ["cancelación", "terminación"],
      palabrasClaves: "resolución",
    },
    {
      original: "suscribir",
      sugerencias: ["firmar"],
      palabrasClaves: "suscribir",
    },
    {
      original: "suscripto",
      sugerencias: ["firmado"],
      palabrasClaves: "suscripto",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = this.buildAccentInsensitivePattern(item.palabrasClaves);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        const sugerencias = item.sugerencias.map((s) =>
          this.mantenerCase(match[0], s),
        );
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia: sugerencias[0],
          sugerencias,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por lenguaje más claro`,
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
window.docsReviewerRules.push(tecnicismosRule);
