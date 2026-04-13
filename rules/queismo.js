const DEFAULT_PATTERNS = {
  globalExclusions: [],
  requiere_de_que: [],
  nunca_de_que: [],
};

const CONFIDENCE_ORDER = {
  alta: 3,
  media: 2,
  baja: 1,
};

const queismoRule = {
  id: "queismo",
  nombre: "Queismo y dequeismo",
  descripcion:
    "Detecta posible queismo y posible dequeismo con patrones curados y contexto local",
  color: "#f1c40f",
  _patterns: null,
  _nlpEngine: undefined,
  _engineName: null,

  detectar(texto) {
    if (typeof texto !== "string" || texto.length === 0) {
      return [];
    }

    const patterns = this.getPatterns();
    const segments = this.segmentarOraciones(texto);
    const matches = [];

    this.detectarGrupo({
      entries: patterns.requiere_de_que,
      segments,
      sourceText: texto,
      globalExclusions: patterns.globalExclusions,
      matches,
    });

    this.detectarGrupo({
      entries: patterns.nunca_de_que,
      segments,
      sourceText: texto,
      globalExclusions: patterns.globalExclusions,
      matches,
    });

    return matches;
  },

  getPatterns() {
    if (this._patterns) return this._patterns;

    const url = chrome.runtime.getURL("rules/patterns.json");

    try {
      const request = new XMLHttpRequest();
      request.open("GET", url, false);
      request.send(null);

      if (request.status >= 200 && request.status < 300) {
        const parsed = JSON.parse(request.responseText);
        this._patterns = {
          globalExclusions: Array.isArray(parsed.globalExclusions)
            ? parsed.globalExclusions
            : [],
          requiere_de_que: Array.isArray(parsed.requiere_de_que)
            ? parsed.requiere_de_que
            : [],
          nunca_de_que: Array.isArray(parsed.nunca_de_que)
            ? parsed.nunca_de_que
            : [],
        };
        return this._patterns;
      }
    } catch (error) {
      console.warn(
        "[Legal Docs] No se pudo cargar rules/patterns.json:",
        error,
      );
    }

    this._patterns = DEFAULT_PATTERNS;
    return this._patterns;
  },

  getNlpEngine() {
    if (this._nlpEngine !== undefined) {
      return this._nlpEngine;
    }

    if (typeof window.esCompromise === "function") {
      this._nlpEngine = window.esCompromise;
      this._engineName = "es-compromise";
      return this._nlpEngine;
    }

    if (typeof window.nlp === "function") {
      this._nlpEngine = window.nlp;
      this._engineName = "compromise";
      return this._nlpEngine;
    }

    this._nlpEngine = null;
    this._engineName = "fallback";
    console.warn(
      "[Legal Docs] Compromise no disponible; se usa fallback de segmentacion para queismo/dequeismo",
    );
    return this._nlpEngine;
  },

  segmentarOraciones(texto) {
    const nlp = this.getNlpEngine();

    if (nlp) {
      try {
        const sentenceTexts = nlp(texto).sentences().out("array");
        const mapped = [];
        let cursor = 0;

        sentenceTexts.forEach((sentenceText) => {
          if (!sentenceText || !sentenceText.trim()) return;

          const start = texto.indexOf(sentenceText, cursor);
          if (start === -1) return;

          const end = start + sentenceText.length;
          mapped.push({ text: sentenceText, start, end });
          cursor = end;
        });

        if (mapped.length > 0) {
          return mapped;
        }
      } catch (error) {
        console.warn("[Legal Docs] Error segmentando con compromise:", error);
      }
    }

    const fallbackSegments = [];
    const regex = /[^.!?\n]+[.!?\n]?/g;
    let match;

    while ((match = regex.exec(texto)) !== null) {
      if (!match[0].trim()) continue;
      fallbackSegments.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return fallbackSegments;
  },

  tokenizarOracion(oracion) {
    const nlp = this.getNlpEngine();
    if (!nlp) {
      return (oracion.match(/\S+/g) || []).map((token) => ({ text: token }));
    }

    try {
      const tokens = nlp(oracion).terms().out("array");
      return tokens.map((token) => ({ text: token }));
    } catch (error) {
      return (oracion.match(/\S+/g) || []).map((token) => ({ text: token }));
    }
  },

  construirVentanaLocal(oracion, localStart, localEnd) {
    const tokens = this.tokenizarOracion(oracion);
    if (tokens.length === 0) {
      return oracion.slice(
        Math.max(0, localStart - 50),
        Math.min(oracion.length, localEnd + 50),
      );
    }

    const ranges = [];
    let cursor = 0;

    tokens.forEach((token) => {
      const normalized = token.text.trim();
      if (!normalized) return;

      const at = oracion.indexOf(normalized, cursor);
      if (at === -1) return;

      ranges.push({ start: at, end: at + normalized.length, text: normalized });
      cursor = at + normalized.length;
    });

    if (ranges.length === 0) {
      return oracion.slice(
        Math.max(0, localStart - 50),
        Math.min(oracion.length, localEnd + 50),
      );
    }

    let firstTokenIndex = 0;
    let lastTokenIndex = ranges.length - 1;

    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges[index].end > localStart) {
        firstTokenIndex = index;
        break;
      }
    }

    for (let index = firstTokenIndex; index < ranges.length; index += 1) {
      if (ranges[index].start >= localEnd) {
        lastTokenIndex = Math.max(firstTokenIndex, index - 1);
        break;
      }
    }

    const windowStart = Math.max(0, firstTokenIndex - 5);
    const windowEnd = Math.min(ranges.length - 1, lastTokenIndex + 5);
    const charStart = ranges[windowStart].start;
    const charEnd = ranges[windowEnd].end;

    return oracion.slice(charStart, charEnd);
  },

  esExclusion(pattern, text) {
    if (!pattern || !text) return false;

    try {
      const exclusionRegex = new RegExp(pattern, "i");
      return exclusionRegex.test(text);
    } catch (error) {
      return false;
    }
  },

  tieneExclusion(entry, sentenceText, localWindow, globalExclusions) {
    const ruleExclusions = Array.isArray(entry.exclusions)
      ? entry.exclusions
      : [];
    const allExclusions = [...globalExclusions, ...ruleExclusions];

    return allExclusions.some((pattern) => {
      return (
        this.esExclusion(pattern, sentenceText) ||
        this.esExclusion(pattern, localWindow)
      );
    });
  },

  normalizarConfianza(confidence) {
    if (
      confidence === "alta" ||
      confidence === "media" ||
      confidence === "baja"
    ) {
      return confidence;
    }
    return "media";
  },

  calcularSeveridad(entry, localWindow) {
    const base = this.normalizarConfianza(entry.confidence);
    const hasHedge = /\b(posible|quizas|tal\s+vez|probablemente)\b/i.test(
      localWindow,
    );

    if (!hasHedge) {
      return base;
    }

    const score = Math.max(1, (CONFIDENCE_ORDER[base] || 2) - 1);
    if (score >= 3) return "alta";
    if (score === 2) return "media";
    return "baja";
  },

  detectarGrupo({ entries, segments, sourceText, globalExclusions, matches }) {
    entries.forEach((entry) => {
      if (!entry || !entry.triggerPattern) return;

      let triggerRegex;
      try {
        triggerRegex = new RegExp(entry.triggerPattern, "gi");
      } catch (error) {
        console.warn(
          "[Legal Docs] Patron invalido en queismo/dequeismo:",
          entry.id,
          error,
        );
        return;
      }

      segments.forEach((segment) => {
        let hit;

        while ((hit = triggerRegex.exec(segment.text)) !== null) {
          const localStart = hit.index;
          const localEnd = hit.index + hit[0].length;
          const localWindow = this.construirVentanaLocal(
            segment.text,
            localStart,
            localEnd,
          );

          if (
            this.tieneExclusion(
              entry,
              segment.text,
              localWindow,
              globalExclusions,
            )
          ) {
            continue;
          }

          const absoluteStart = segment.start + localStart;
          const absoluteEnd = segment.start + localEnd;
          const tipoHallazgo =
            entry.type === "dequeismo" ? "dequeismo" : "queismo";
          const severidad = this.calcularSeveridad(entry, localWindow);
          const label = entry.label || "construccion";
          const uxTitle =
            tipoHallazgo === "dequeismo"
              ? "Posible dequeismo"
              : "Posible queismo";

          matches.push({
            id: `${this.id}-${tipoHallazgo}-${entry.id || "pattern"}-${absoluteStart}-${absoluteEnd}`,
            inicio: absoluteStart,
            fin: absoluteEnd,
            textoOriginal: sourceText.slice(absoluteStart, absoluteEnd),
            sugerencia: uxTitle,
            regla: this.id,
            descripcion: `${uxTitle} en ${label}. Confianza ${severidad}.`,
            tipoHallazgo,
            severidad,
            confianza: this.normalizarConfianza(entry.confidence),
            ventanaLocal: localWindow,
            motorNlp: this._engineName,
          });
        }

        triggerRegex.lastIndex = 0;
      });
    });
  },
};

// Registrar la regla en el objeto global
if (typeof window.docsReviewerRules === "undefined") {
  window.docsReviewerRules = [];
}
window.docsReviewerRules.push(queismoRule);
