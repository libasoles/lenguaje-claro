import type { Match, NlpEngine, Rule } from "../types.js";

type VerbTense = "presente" | "pasado";
type AgreementNumber = "singular" | "plural";
type IrregularVerbForms = Record<
  VerbTense,
  Record<AgreementNumber, string>
>;
type PassiveRegexes = {
  patientBefore: RegExp;
  patientAfter: RegExp;
};
type TextRange = Pick<Match, "inicio" | "fin">;

type VozPasivaRule = Rule & {
  _nlpEngine: NlpEngine | null | undefined;
  _irregularParticipleMap: Record<string, string> | null;
  _participlePattern: string | null;
  _regexes: PassiveRegexes | null;
  _agentlessRegex: RegExp | null;
  irregularForms: Record<string, IrregularVerbForms>;
  getNlpEngine(): NlpEngine | null;
  normalizeToken(value: string): string;
  getAgreementNumber(text: string | null | undefined): AgreementNumber;
  inferRegularVerb(
    participle: string,
    tense: VerbTense,
    number: AgreementNumber,
  ): string | null;
  getActiveVerb(
    participle: string,
    auxiliary: string,
    number: AgreementNumber,
  ): string | null;
  getIrregularParticipleMap(): Record<string, string>;
  getIrregularBaseParticiple(normalizedParticiple: string): string | null;
  getParticiplePattern(): string;
  buildRegexes(): PassiveRegexes;
  buildAgentlessRegex(): RegExp;
  isSentenceBoundary(texto: string, index: number): boolean;
  normalizePatientForSuggestion(
    patient: string | null,
    isLeadingPatient: boolean,
  ): string | null;
  buildActiveSuggestion(
    auxiliary: string,
    participle: string,
    patientBefore: string | null,
    patientAfter: string | null,
    agent: string | null,
    capitalize?: boolean,
  ): string | null;
  isParticiple(word: string, auxiliary: string): boolean;
  detectarSinAgente(
    texto: string,
    agentMatchRanges: TextRange[],
    matches: Match[],
  ): void;
};

export const vozPasivaRule = {
  id: "voz-pasiva",
  nombre: "Voz pasiva",
  descripcion: "Reemplaza construcciones pasivas por voz activa más directa",
  color: "#f1c40f", // Amarillo

  _nlpEngine: undefined as NlpEngine | null | undefined,
  _irregularParticipleMap: null as Record<string, string> | null,
  _participlePattern: null as string | null,
  _regexes: null as PassiveRegexes | null,
  _agentlessRegex: null as RegExp | null,

  irregularForms: {
    abierto: {
      presente: { singular: "abre", plural: "abren" },
      pasado: { singular: "abrió", plural: "abrieron" },
    },
    absuelto: {
      presente: { singular: "absuelve", plural: "absuelven" },
      pasado: { singular: "absolvió", plural: "absolvieron" },
    },
    cubierto: {
      presente: { singular: "cubre", plural: "cubren" },
      pasado: { singular: "cubrió", plural: "cubrieron" },
    },
    dicho: {
      presente: { singular: "dice", plural: "dicen" },
      pasado: { singular: "dijo", plural: "dijeron" },
    },
    dispuesto: {
      presente: { singular: "dispone", plural: "disponen" },
      pasado: { singular: "dispuso", plural: "dispusieron" },
    },
    escrito: {
      presente: { singular: "escribe", plural: "escriben" },
      pasado: { singular: "escribió", plural: "escribieron" },
    },
    hecho: {
      presente: { singular: "hace", plural: "hacen" },
      pasado: { singular: "hizo", plural: "hicieron" },
    },
    interpuesto: {
      presente: { singular: "interpone", plural: "interponen" },
      pasado: { singular: "interpuso", plural: "interpusieron" },
    },
    muerto: {
      presente: { singular: "muere", plural: "mueren" },
      pasado: { singular: "murió", plural: "murieron" },
    },
    caido: {
      presente: { singular: "cae", plural: "caen" },
      pasado: { singular: "cayó", plural: "cayeron" },
    },
    leido: {
      presente: { singular: "lee", plural: "leen" },
      pasado: { singular: "leyó", plural: "leyeron" },
    },
    oido: {
      presente: { singular: "oye", plural: "oyen" },
      pasado: { singular: "oyó", plural: "oyeron" },
    },
    puesto: {
      presente: { singular: "pone", plural: "ponen" },
      pasado: { singular: "puso", plural: "pusieron" },
    },
    resuelto: {
      presente: { singular: "resuelve", plural: "resuelven" },
      pasado: { singular: "resolvió", plural: "resolvieron" },
    },
    roto: {
      presente: { singular: "rompe", plural: "rompen" },
      pasado: { singular: "rompió", plural: "rompieron" },
    },
    suscrito: {
      presente: { singular: "suscribe", plural: "suscriben" },
      pasado: { singular: "suscribió", plural: "suscribieron" },
    },
    traido: {
      presente: { singular: "trae", plural: "traen" },
      pasado: { singular: "trajo", plural: "trajeron" },
    },
    visto: {
      presente: { singular: "ve", plural: "ven" },
      pasado: { singular: "vio", plural: "vieron" },
    },
  },

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

  normalizeToken(value: string): string {
    return value
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  },

  getAgreementNumber(text: string | null | undefined): AgreementNumber {
    if (!text) return "singular";

    const normalized = this.normalizeToken(text.trim());
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const firstToken = tokens[0] || "";

    if (
      firstToken === "los" ||
      firstToken === "las" ||
      firstToken === "unos" ||
      firstToken === "unas" ||
      /(?:s|es)$/.test(firstToken)
    ) {
      return "plural";
    }

    return "singular";
  },

  inferRegularVerb(
    participle: string,
    tense: VerbTense,
    number: AgreementNumber,
  ): string | null {
    const lowerParticiple = this.normalizeToken(participle);
    const regularEnding = /(ados|adas|ado|ada|idos|idas|ido|ida)$/i.exec(
      lowerParticiple,
    );

    if (!regularEnding) return null;

    const ending = regularEnding[0];
    const stem = lowerParticiple.slice(0, -ending.length);

    if (!stem) return null;

    const isArVerb = ending.startsWith("ad");

    if (tense === "presente") {
      return isArVerb
        ? number === "plural"
          ? `${stem}an`
          : `${stem}a`
        : number === "plural"
          ? `${stem}en`
          : `${stem}e`;
    }

    return isArVerb
      ? number === "plural"
        ? `${stem}aron`
        : `${stem}ó`
      : number === "plural"
        ? `${stem}ieron`
        : `${stem}ió`;
  },

  getActiveVerb(
    participle: string,
    auxiliary: string,
    number: AgreementNumber,
  ): string | null {
    const normalizedParticiple = this.normalizeToken(participle);
    const tense = /^(fue|fueron)$/i.test(auxiliary) ? "pasado" : "presente";
    const irregularBase = this.getIrregularBaseParticiple(normalizedParticiple);
    const irregularEntry = irregularBase
      ? this.irregularForms[irregularBase]
      : null;

    if (irregularEntry) {
      return irregularEntry[tense][number];
    }

    const regularForm = this.inferRegularVerb(participle, tense, number);
    if (!regularForm) return null;

    return regularForm;
  },

  getIrregularParticipleMap(): Record<string, string> {
    if (this._irregularParticipleMap) {
      return this._irregularParticipleMap;
    }

    const map: Record<string, string> = {};

    Object.keys(this.irregularForms).forEach((base) => {
      const feminine = base.replace(/o$/, "a");
      const masculinePlural = base.replace(/o$/, "os");
      const femininePlural = base.replace(/o$/, "as");
      [base, feminine, masculinePlural, femininePlural].forEach((form) => {
        map[form] = base;
      });
    });

    this._irregularParticipleMap = map;
    return map;
  },

  getIrregularBaseParticiple(normalizedParticiple: string): string | null {
    return this.getIrregularParticipleMap()[normalizedParticiple] || null;
  },

  getParticiplePattern(): string {
    if (this._participlePattern) {
      return this._participlePattern;
    }

    const irregularAlternatives = Object.keys(this.getIrregularParticipleMap())
      .sort((left, right) => right.length - left.length)
      .join("|");
    const regularAlternatives =
      "[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:ados|adas|ado|ada|idos|idas|ido|ida|ídos|ídas|ído|ída)";

    this._participlePattern = `(?:${regularAlternatives}|${irregularAlternatives})`;
    return this._participlePattern;
  },

  buildRegexes(): PassiveRegexes {
    if (this._regexes) {
      return this._regexes;
    }

    const determinerPattern =
      "(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|aquel|aquella|aquellos|aquellas|mi|mis|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras)";
    const auxiliaryPattern = "(fue|fueron|es|son)";
    const participlePattern = this.getParticiplePattern();
    const patientBeforePattern = `((?:${determinerPattern})\\s+[^.!?\\n,;:]+?)`;
    const patientAfterPattern = "([^.!?\\n]+?)";
    const agentPattern =
      "([^.!?\\n;:,]+?)(?=\\s+(?:en|desde|hasta|durante|antes|después|el\\s+día|a\\s+partir)\\b|[,.;:!?\\n]|$)";

    this._regexes = {
      patientBefore: new RegExp(
        `\\b${patientBeforePattern}\\s+${auxiliaryPattern}\\s+(${participlePattern})\\s+por\\s+${agentPattern}`,
        "gi",
      ),
      patientAfter: new RegExp(
        `\\b${auxiliaryPattern}\\s+(${participlePattern})(?:\\s+${patientAfterPattern})?\\s+por\\s+${agentPattern}`,
        "gi",
      ),
    };

    return this._regexes;
  },

  buildAgentlessRegex(): RegExp {
    if (this._agentlessRegex) return this._agentlessRegex;
    const participlePattern = this.getParticiplePattern();
    this._agentlessRegex = new RegExp(
      `\\b(fue|fueron)\\s+(${participlePattern})(?!\\s+por\\b)`,
      "gi",
    );
    return this._agentlessRegex;
  },

  isSentenceBoundary(texto: string, index: number): boolean {
    if (index <= 0) return true;

    let wordEnd = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const char = texto[cursor];
      if (/\s/.test(char)) continue;
      if (/[.!?(\n:;,]/.test(char)) return true;
      wordEnd = cursor;
      break;
    }

    if (wordEnd < 0) return true;

    let wordStart = wordEnd;
    while (wordStart > 0 && !/[\s.!?(\n:;,]/.test(texto[wordStart - 1])) {
      wordStart -= 1;
    }

    const previousWord = this.normalizeToken(
      texto.slice(wordStart, wordEnd + 1),
    );
    const clauseConnectors = new Set([
      "que",
      "cual",
      "cuales",
      "quien",
      "quienes",
      "donde",
      "cuyo",
      "cuya",
      "cuyos",
      "cuyas",
      "porque",
      "pues",
      "si",
      "cuando",
      "mientras",
      "aunque",
    ]);
    return clauseConnectors.has(previousWord);
  },

  normalizePatientForSuggestion(
    patient: string | null,
    isLeadingPatient: boolean,
  ): string | null {
    if (!patient) return null;
    if (!isLeadingPatient) return patient.trim();

    const trimmed = patient.trim();
    return trimmed.charAt(0).toLocaleLowerCase() + trimmed.slice(1);
  },

  buildActiveSuggestion(
    auxiliary: string,
    participle: string,
    patientBefore: string | null,
    patientAfter: string | null,
    agent: string | null,
    capitalize = true,
  ): string | null {
    const cleanedObject = patientBefore
      ? this.normalizePatientForSuggestion(patientBefore, true)
      : patientAfter
        ? this.normalizePatientForSuggestion(patientAfter, false)
        : null;
    const cleanedAgent = agent ? agent.trim() : null;

    if (!cleanedAgent) {
      return null;
    }

    const number = this.getAgreementNumber(cleanedAgent);
    const verb = this.getActiveVerb(participle, auxiliary, number);

    if (!verb) {
      return null;
    }

    const suggestion = cleanedObject
      ? `${cleanedAgent} ${verb} ${cleanedObject}`
      : `${cleanedAgent} ${verb}`;

    if (!capitalize) {
      return suggestion.charAt(0).toLocaleLowerCase() + suggestion.slice(1);
    }
    return suggestion.charAt(0).toLocaleUpperCase() + suggestion.slice(1);
  },

  // Use NLP (when available) to confirm a word is a verbal participle rather than an adjective/noun.
  isParticiple(word: string, auxiliary: string): boolean {
    const nlp = this.getNlpEngine();
    if (nlp) {
      try {
        const terms = nlp(`${auxiliary} ${word}`).terms().json();
        const wordTerm = terms.find(
          (t) => t.text?.toLowerCase() === word.toLowerCase(),
        );
        if (wordTerm) {
          const tags = wordTerm.terms?.[0]?.tags || [];
          if (
            tags.length > 0 &&
            !tags.includes("Verb") &&
            !tags.includes("Adjective")
          ) {
            return false;
          }
        }
      } catch (_) {}
    }
    // Morphological fallback: regular -ado/-ada/-ido/-ida endings or known irregulars
    return (
      /(?:ados|adas|ado|ada|idos|idas|ido|ida|ídos|ídas|ído|ída)$/i.test(
        word,
      ) || this.getIrregularBaseParticiple(this.normalizeToken(word)) !== null
    );
  },

  detectarSinAgente(
    texto: string,
    agentMatchRanges: TextRange[],
    matches: Match[],
  ): void {
    const regex = this.buildAgentlessRegex();
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(texto)) !== null) {
      const inicio = match.index;
      const fin = match.index + match[0].length;

      // Skip if the auxiliary falls within an already-detected agent-based match
      if (agentMatchRanges.some((r) => inicio >= r.inicio && inicio < r.fin)) {
        continue;
      }

      if (!this.isSentenceBoundary(texto, inicio)) continue;

      const auxiliary = match[1];
      const participle = match[2];

      if (!this.isParticiple(participle, auxiliary)) continue;

      const verb = this.getActiveVerb(participle, auxiliary, "singular");
      if (!verb) continue;

      const sugerencia = `se ${verb}`;

      matches.push({
        id: `${this.id}-${matches.length}`,
        inicio,
        fin,
        textoOriginal: match[0],
        sugerencias: [sugerencia],
        regla: this.id,
        descripcion: `Voz pasiva sin agente. Considere: "${sugerencia}".`,
      });
    }
  },

  detectar(texto: string): Match[] {
    const matches: Match[] = [];
    const seenRanges = new Set<string>();
    const { patientBefore, patientAfter } = this.buildRegexes();
    let match: RegExpExecArray | null;

    while ((match = patientBefore.exec(texto)) !== null) {
      // Skip patients that cross a subordinate clause ("que"), which produce wrong suggestions
      if (/\bque\b/i.test(match[1])) continue;

      const inicio = match.index;
      const fin = match.index + match[0].length;
      const atSentenceStart = this.isSentenceBoundary(texto, inicio);
      const sugerencia = this.buildActiveSuggestion(
        match[2],
        match[3],
        match[1],
        null,
        match[4],
        atSentenceStart,
      );

      if (!sugerencia) {
        continue;
      }

      seenRanges.add(`${inicio}-${fin}`);
      matches.push({
        id: `${this.id}-${matches.length}`,
        inicio,
        fin,
        textoOriginal: match[0].trim(),
        sugerencias: [sugerencia],
        regla: this.id,
        descripcion: `Voz pasiva detectada. Propuesta en voz activa: "${sugerencia}".`,
      });
    }

    while ((match = patientAfter.exec(texto)) !== null) {
      if (!this.isSentenceBoundary(texto, match.index)) {
        continue;
      }

      const inicio = match.index;
      const fin = match.index + match[0].length;
      const rangeKey = `${inicio}-${fin}`;

      if (seenRanges.has(rangeKey)) {
        continue;
      }

      const sugerencia = this.buildActiveSuggestion(
        match[1],
        match[2],
        null,
        match[3],
        match[4],
      );

      if (!sugerencia) {
        continue;
      }

      matches.push({
        id: `${this.id}-${matches.length}`,
        inicio,
        fin,
        textoOriginal: match[0].trim(),
        sugerencias: [sugerencia],
        regla: this.id,
        descripcion: `Voz pasiva detectada. Propuesta en voz activa: "${sugerencia}".`,
      });
    }

    // Detect agentless passives ("fue dictada sin considerar...") using NLP to filter adjectives
    const agentMatchRanges = matches.map((m) => ({
      inicio: m.inicio,
      fin: m.fin,
    }));
    this.detectarSinAgente(texto, agentMatchRanges, matches);

    return matches;
  },
} satisfies VozPasivaRule;

export default vozPasivaRule;
