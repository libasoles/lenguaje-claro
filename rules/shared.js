export const accentInsensitiveUtils = {
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
};

export function buildAccentInsensitivePattern(text) {
  return accentInsensitiveUtils.buildAccentInsensitivePattern(text);
}

export function getWordCaseStyle(word) {
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
}

export function applyWordCaseStyle(word, style) {
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

export function mantenerCase(original, sugerencia) {
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
        getWordCaseStyle(word) === "capitalized" ||
        getWordCaseStyle(word) === "lower",
    ) &&
    getWordCaseStyle(originalWords[0]) === "capitalized"
  ) {
    const suggestionWords = sugerencia.split(/(\s+)/);
    let wordIndex = 0;

    return suggestionWords
      .map((segment) => {
        if (!segment.trim()) return segment;

        const sourceWord = originalWords[wordIndex] || originalWords.at(-1);
        const style = getWordCaseStyle(sourceWord);
        wordIndex += 1;
        return applyWordCaseStyle(segment, style);
      })
      .join("");
  }

  if (
    getWordCaseStyle(originalWords[0]) === "capitalized" &&
    originalWords.slice(1).every((word) => getWordCaseStyle(word) === "lower")
  ) {
    return (
      sugerencia.charAt(0).toLocaleUpperCase() +
      sugerencia.slice(1).toLocaleLowerCase()
    );
  }

  return sugerencia;
}
