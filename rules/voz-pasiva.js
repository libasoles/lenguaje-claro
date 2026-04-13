const vozPasivaRule = {
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
        : `${stem}o`
      : number === "plural"
        ? `${stem}ieron`
        : `${stem}io`;
  },

  restoreAccents(word, tense) {
    if (!word) return word;

    if (tense !== "pasado") {
      return word;
    }

    return word.replace(/o$/, "ó").replace(/io$/, "ió");
  },

  getActiveVerb(participle, auxiliary, number) {
    const normalizedParticiple = this.normalizeToken(participle);
    const tense = /^(fue|fueron)$/i.test(auxiliary) ? "pasado" : "presente";
    const irregularEntry = this.irregularForms[normalizedParticiple];

    if (irregularEntry) {
      return irregularEntry[tense][number];
    }

    const regularForm = this.inferRegularVerb(participle, tense, number);
    if (!regularForm) return null;

    return this.restoreAccents(regularForm, tense);
  },

  buildActiveSuggestion(auxiliary, participle, object, agent) {
    const cleanedObject = object ? object.trim() : null;
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

    // Patrón: "fue/fueron/es/son + participio + [objeto/adv] + por + agente"
    // El grupo intermedio es opcional (el objeto puede preceder al auxiliar).
    // Ningún grupo cruza límites de oración (no se permite . ! ?).
    // El agente se acota antes de preposiciones adverbiales (en, desde, hasta…).
    const regex =
      /\b(fue|fueron|es|son)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:ado|ada|ados|adas|ido|ida|idos|idas|to|ta|tos|tas|cho|cha|chos|chas|so|sa|sos|sas))(?:\s+([^.!?\n]+?))?\s+por\s+([^.!?\n;:,]+?)(?=\s+(?:en|desde|hasta|durante|antes|después|el\s+día|a\s+partir)\b|[,.;:!?\n]|$)/gi;
    let match;

    while ((match = regex.exec(texto)) !== null) {
      const inicio = match.index;
      const fin = match.index + match[0].length;
      const sugerencia = this.buildActiveSuggestion(
        match[1],
        match[2],
        match[3],
        match[4],
      );

      matches.push({
        id: `${this.id}-${matches.length}`,
        inicio: inicio,
        fin: fin,
        textoOriginal: match[0].trim(),
        sugerencia: sugerencia || "(considera usar voz activa)",
        regla: this.id,
        descripcion: sugerencia
          ? `Voz pasiva detectada. Propuesta en voz activa: "${sugerencia}".`
          : "Voz pasiva detectada. Considera reestructurar en voz activa.",
      });
    }

    return matches;
  },
};

// Registrar la regla en el objeto global
if (typeof window.docsReviewerRules === "undefined") {
  window.docsReviewerRules = [];
}
window.docsReviewerRules.push(vozPasivaRule);
