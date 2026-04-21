import { buildAccentInsensitivePattern, mantenerCase } from "../shared.js";
import type { Match, NlpEngine, NlpTermJson, Pattern, Rule } from "../types.js";
import diccionario from "./patterns.json";

type Gender = "masculine" | "feminine";

type DeterminerExpansion = {
  inicio: number;
  textoOriginal: string;
};

const GENDERED_DETERMINERS: Record<string, Record<Gender, string>> = {
  el: { masculine: "el", feminine: "la" },
  la: { masculine: "el", feminine: "la" },
  los: { masculine: "los", feminine: "las" },
  las: { masculine: "los", feminine: "las" },
  un: { masculine: "un", feminine: "una" },
  una: { masculine: "un", feminine: "una" },
  unos: { masculine: "unos", feminine: "unas" },
  unas: { masculine: "unos", feminine: "unas" },
  este: { masculine: "este", feminine: "esta" },
  esta: { masculine: "este", feminine: "esta" },
  estos: { masculine: "estos", feminine: "estas" },
  estas: { masculine: "estos", feminine: "estas" },
  ese: { masculine: "ese", feminine: "esa" },
  esa: { masculine: "ese", feminine: "esa" },
  esos: { masculine: "esos", feminine: "esas" },
  esas: { masculine: "esos", feminine: "esas" },
  aquel: { masculine: "aquel", feminine: "aquella" },
  aquella: { masculine: "aquel", feminine: "aquella" },
  aquellos: { masculine: "aquellos", feminine: "aquellas" },
  aquellas: { masculine: "aquellos", feminine: "aquellas" },
  dicho: { masculine: "dicho", feminine: "dicha" },
  dicha: { masculine: "dicho", feminine: "dicha" },
  dichos: { masculine: "dichos", feminine: "dichas" },
  dichas: { masculine: "dichos", feminine: "dichas" },
};

const LEADING_DETERMINER_PATTERN =
  /^(el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella|aquellos|aquellas|dicho|dicha|dichos|dichas)\b/i;

const NO_ARTICLE_START_PATTERN =
  /^(quien|qué|cómo|cuándo|dónde|cuánto|cuál|de|por|para|con|sin)\b/i;

const FEMININE_EXCEPTIONS = new Set([
  "clase",
  "gente",
  "ley",
  "mano",
  "parte",
  "superficie",
]);

const MASCULINE_EXCEPTIONS = new Set([
  "dia",
  "juez",
  "mapa",
  "problema",
  "sistema",
  "tema",
  "tramite",
]);

type TecnicismosRule = Rule & {
  _nlpEngine: NlpEngine | null | undefined;
  diccionario: Pattern[];
  getNlpEngine(): NlpEngine | null;
  _simpleDeterminers: RegExp;
  tryExpandDeterminer(
    texto: string,
    inicio: number,
    textoOriginal: string,
  ): DeterminerExpansion;
  _mapArticle(originalArticle: string, suggestion: string): string;
  _inferSuggestionGender(suggestion: string): Gender | null;
  _genderFromNlpTerms(terms: NlpTermJson[]): Gender | null;
  _genderFromTags(tags: string[]): Gender | null;
  _firstContentWord(text: string): string | null;
  _inferGenderFromWord(word: string | null): Gender | null;
};

export const tecnicismosRule = {
  id: "tecnicismos",
  nombre: "Tecnicismo",
  descripcion: "Reemplaza términos técnicos por lenguaje llano",
  color: "#e67e22", // Naranja

  _nlpEngine: undefined as NlpEngine | null | undefined,

  // Cada entrada puede tener `sugerencias` (array) para ofrecer múltiples opciones.
  // dropDeterminer: true indica que la sugerencia no lleva artículo propio, por lo que
  // si el término va precedido de un determinante ("el actor", "este juzgador") se expande
  // el match para incluirlo y eliminarlo de la sugerencia.
  diccionario,

  getNlpEngine(): NlpEngine | null {
    if (this._nlpEngine !== undefined) {
      return this._nlpEngine;
    }

    if (
      typeof window !== "undefined" &&
      typeof window.esCompromise === "function"
    ) {
      this._nlpEngine = window.esCompromise;
      return this._nlpEngine;
    }

    if (typeof window !== "undefined" && typeof window.nlp === "function") {
      this._nlpEngine = window.nlp;
      return this._nlpEngine;
    }

    this._nlpEngine = null;
    return this._nlpEngine;
  },

  // Artículos y demostrativos simples que pueden preceder a tecnicismos legales.
  // No incluye contracciones "al"/"del" porque llevan preposición que debe conservarse.
  _simpleDeterminers:
    /^(el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella|aquellos|aquellas|dicho|dicha|dichos|dichas)$/i,

  // Si el término va precedido de un determinante simple, expande el match para incluirlo.
  // Así "el actor" se reemplaza completo por "quien demanda" (sin duplicar el artículo).
  tryExpandDeterminer(
    texto: string,
    inicio: number,
    textoOriginal: string,
  ): DeterminerExpansion {
    const nlp = this.getNlpEngine();
    const before = texto.slice(0, inicio);
    const wordMatch = /(\S+)(\s+)$/.exec(before);
    if (!wordMatch) return { inicio, textoOriginal };

    const precWord = wordMatch[1];
    let isDeterminer = false;

    if (nlp) {
      try {
        const terms = nlp(precWord).terms().json();
        const tags = terms[0]?.terms?.[0]?.tags || [];
        isDeterminer =
          tags.includes("Determiner") ||
          (tags.includes("Adjective") &&
            this._simpleDeterminers.test(precWord));
      } catch (_) {
        isDeterminer = this._simpleDeterminers.test(precWord);
      }
    } else {
      isDeterminer = this._simpleDeterminers.test(precWord);
    }

    if (!isDeterminer) return { inicio, textoOriginal };

    const newInicio = inicio - wordMatch[0].length;
    return {
      inicio: Math.max(0, newInicio),
      textoOriginal: precWord + wordMatch[2] + textoOriginal,
    };
  },

  // Decide un determinante adecuado para el núcleo inicial de la sugerencia.
  // Usa es-compromise cuando está disponible y una heurística local como respaldo.
  _mapArticle(originalArticle: string, suggestion: string): string {
    if (!originalArticle) return "";
    const orig = originalArticle.toLowerCase();

    // Si la sugerencia ya incluye determinante, devolverla tal cual.
    if (LEADING_DETERMINER_PATTERN.test(suggestion)) return "";

    // Si la sugerencia comienza con palabras que no toman artículo, no agregar uno.
    if (NO_ARTICLE_START_PATTERN.test(suggestion)) {
      return "";
    }

    const forms = GENDERED_DETERMINERS[orig];
    if (!forms) return orig;

    const gender = this._inferSuggestionGender(suggestion);
    return gender ? forms[gender] : orig;
  },

  _inferSuggestionGender(suggestion: string): Gender | null {
    const nlp = this.getNlpEngine();

    if (nlp) {
      try {
        const gender = this._genderFromNlpTerms(nlp(suggestion).terms().json());
        if (gender) return gender;
      } catch (_) {}
    }

    return this._inferGenderFromWord(this._firstContentWord(suggestion));
  },

  _genderFromNlpTerms(terms: NlpTermJson[]): Gender | null {
    for (const entry of terms) {
      const term = entry.terms?.[0];
      const tags = term?.tags || [];
      const text = term?.text || entry.text;

      if (!text) continue;
      if (
        tags.includes("Determiner") ||
        tags.includes("Preposition") ||
        tags.includes("Conjunction")
      ) {
        continue;
      }

      const gender = this._genderFromTags(tags);
      if (gender) return gender;

      // El artículo debe concordar con el primer término léxico, no con
      // sustantivos posteriores dentro de complementos ("persona que recibe...").
      break;
    }

    return null;
  },

  _genderFromTags(tags: string[]): Gender | null {
    if (tags.includes("FemaleNoun") || tags.includes("FemaleAdjective")) {
      return "feminine";
    }

    if (tags.includes("MaleNoun") || tags.includes("MaleAdjective")) {
      return "masculine";
    }

    return null;
  },

  _firstContentWord(text: string): string | null {
    return (
      text
        .trim()
        .match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/u)?.[0] || null
    );
  },

  _inferGenderFromWord(word: string | null): Gender | null {
    if (!word) return null;

    const normalized = word
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (FEMININE_EXCEPTIONS.has(normalized)) return "feminine";
    if (MASCULINE_EXCEPTIONS.has(normalized)) return "masculine";

    if (/(ciones|siones|dades|tades|tudes|umbres|as|a)$/.test(normalized)) {
      return "feminine";
    }

    if (/(ajes|ores|os|o|aje|or|an)$/.test(normalized)) {
      return "masculine";
    }

    return null;
  },

  detectar(texto: string): Match[] {
    const matches: Match[] = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.original);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(texto)) !== null) {
        let inicio = match.index;
        const fin = match.index + match[0].length;
        let textoOriginal = match[0];
        // Expandir determinante siempre: queremos que casos como "la mora"
        // sean detectados y la sugerencia pueda ajustar el artículo.
        const expanded = this.tryExpandDeterminer(texto, inicio, textoOriginal);
        inicio = expanded.inicio;
        textoOriginal = expanded.textoOriginal;

        // Detectar si el texto original incluye un determinante simple al inicio
        const detMatch =
          /^(\s*)(el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella|aquellos|aquellas|dicho|dicha|dichos|dichas)\b\s*/i.exec(
            textoOriginal,
          );

        const sugerencias = item.sugerencias.map((s) => {
          if (!detMatch) return mantenerCase(textoOriginal, s);
          const originalArticle = detMatch[2];
          const mapped = this._mapArticle(originalArticle, s);
          if (!mapped) return mantenerCase(textoOriginal, s);
          const nounPart = textoOriginal.slice(detMatch[0].length);
          let base = mantenerCase(nounPart, s);
          let articleFinal = /^[A-ZÑÁÉÍÓÚ]/.test(detMatch[2])
            ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
            : mapped;
          let result = articleFinal + " " + base;
          // Si el determinante original empieza con mayúscula, forzar mayúscula inicial en la sugerencia completa
          if (/^[A-ZÑÁÉÍÓÚ]/.test(detMatch[2])) {
            result = result.charAt(0).toUpperCase() + result.slice(1);
          }
          return result;
        });
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio,
          fin,
          textoOriginal,
          sugerencias,
          regla: this.id,
          descripcion: `Reemplazar "${textoOriginal}" por lenguaje más claro`,
        });
      }
    });

    return matches;
  },
} satisfies TecnicismosRule;

export default tecnicismosRule;
