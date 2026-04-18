export const vozPasivaRule = {
  id: "voz-pasiva",
  nombre: "Voz pasiva",
  descripcion: "Reemplaza construcciones pasivas por voz activa más directa",
  color: "#f1c40f", // Amarillo

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

  normalizeToken(value) {
    return value
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  },

  getAgreementNumber(text) {
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

  inferRegularVerb(participle, tense, number) {
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

  getActiveVerb(participle, auxiliary, number) {
    const normalizedParticiple = this.normalizeToken(participle);
    const tense = /^(fue|fueron)$/i.test(auxiliary) ? "pasado" : "presente";
    const irregularBase = this.getIrregularBaseParticiple(normalizedParticiple);
    const irregularEntry = irregularBase ? this.irregularForms[irregularBase] : null;

    if (irregularEntry) {
      return irregularEntry[tense][number];
    }

    const regularForm = this.inferRegularVerb(participle, tense, number);
    if (!regularForm) return null;

    return regularForm;
  },

  getIrregularParticipleMap() {
    if (this._irregularParticipleMap) {
      return this._irregularParticipleMap;
    }

    const map = {};

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

  getIrregularBaseParticiple(normalizedParticiple) {
    return this.getIrregularParticipleMap()[normalizedParticiple] || null;
  },

  getParticiplePattern() {
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

  buildRegexes() {
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

  isSentenceBoundary(texto, index) {
    if (index <= 0) return true;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const char = texto[cursor];
      if (/\s/.test(char)) continue;
      return /[.!?(\n:;]/.test(char);
    }

    return true;
  },

  normalizePatientForSuggestion(patient, isLeadingPatient) {
    if (!patient) return patient;
    if (!isLeadingPatient) return patient.trim();

    const trimmed = patient.trim();
    return trimmed.charAt(0).toLocaleLowerCase() + trimmed.slice(1);
  },

  buildActiveSuggestion(auxiliary, participle, patientBefore, patientAfter, agent) {
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
    return suggestion.charAt(0).toLocaleUpperCase() + suggestion.slice(1);
  },

  detectar(texto) {
    const matches = [];
    const seenRanges = new Set();
    const { patientBefore, patientAfter } = this.buildRegexes();
    let match;

    while ((match = patientBefore.exec(texto)) !== null) {
      const inicio = match.index;
      const fin = match.index + match[0].length;
      const sugerencia = this.buildActiveSuggestion(
        match[2],
        match[3],
        match[1],
        null,
        match[4],
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
        sugerencia,
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
        sugerencia,
        regla: this.id,
        descripcion: `Voz pasiva detectada. Propuesta en voz activa: "${sugerencia}".`,
      });
    }

    return matches;
  },
};

export default vozPasivaRule;
