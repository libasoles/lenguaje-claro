export type WordCaseStyle = "upper" | "lower" | "capitalized" | "mixed";

export const accentInsensitiveUtils = {
  accentInsensitiveMap: {
    a: "[aá]",
    e: "[eé]",
    i: "[ií]",
    o: "[oó]",
    u: "[uúü]",
    n: "[nñ]",
  } as Record<string, string>,

  escapeRegexChar(char: string): string {
    return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  normalizeAccentChar(char: string): string {
    return char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },

  buildAccentInsensitivePattern(text: string): string {
    return Array.from(text)
      .map((char) => {
        const lowerChar = this.normalizeAccentChar(char).toLocaleLowerCase();
        return (
          this.accentInsensitiveMap[lowerChar] || this.escapeRegexChar(char)
        );
      })
      .join("");
  },
};

export function buildAccentInsensitivePattern(text: string): string {
  return accentInsensitiveUtils.buildAccentInsensitivePattern(text);
}

export function getWordCaseStyle(word: string): WordCaseStyle {
  if (!word) return "lower";

  if (word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase())
    return "upper";
  if (word === word.toLocaleLowerCase() && word !== word.toLocaleUpperCase())
    return "lower";

  const firstChar = word.charAt(0);
  const rest = word.slice(1);

  if (
    firstChar === firstChar.toLocaleUpperCase() &&
    firstChar !== firstChar.toLocaleLowerCase() &&
    rest === rest.toLocaleLowerCase()
  ) {
    return "capitalized";
  }

  return "mixed";
}

export function applyWordCaseStyle(
  word: string,
  style: WordCaseStyle,
): string {
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
}

export function mantenerCase(original: string, sugerencia: string): string {
  if (!original || !sugerencia) return sugerencia;

  if (original === original.toLocaleUpperCase()) {
    return sugerencia.toLocaleUpperCase();
  }

  if (original === original.toLocaleLowerCase()) {
    return sugerencia.toLocaleLowerCase();
  }

  const originalWords = original.match(/\S+/g) || [];
  if (originalWords.length === 0) return sugerencia;

  const firstWordStyle = getWordCaseStyle(originalWords[0] || "");

  if (
    originalWords.every(
      (word) =>
        getWordCaseStyle(word) === "capitalized" ||
        getWordCaseStyle(word) === "lower" ||
        getWordCaseStyle(word) === "upper",
    ) &&
    (firstWordStyle === "capitalized" || firstWordStyle === "upper")
  ) {
    const suggestionWords = sugerencia.split(/(\s+)/);
    let wordIndex = 0;

    return suggestionWords
      .map((segment) => {
        if (!segment.trim()) return segment;

        const sourceWord = originalWords[wordIndex] || originalWords.at(-1);
        const style = getWordCaseStyle(sourceWord || "");
        wordIndex += 1;
        // Si el estilo era "upper", pero es una mezcla de palabras,
        // tal vez queramos "capitalized" para la sugerencia si es la primera palabra,
        // o simplemente mantener el comportamiento previo.
        // Forzaremos "capitalized" para la primera palabra si la original era capitalized o upper de una sola letra.
        if (wordIndex === 1 && (style === "capitalized" || style === "upper")) {
          return applyWordCaseStyle(segment, "capitalized");
        }
        return applyWordCaseStyle(segment, style === "upper" ? "lower" : style);
      })
      .join("");
  }

  return sugerencia;
}
