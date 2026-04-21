import type {
  Confidence,
  NlpEngine,
  Match,
  QueismoPattern,
  QueismoPatterns,
  Rule,
  HallazgoTipo,
} from "../types.js";

type SentenceSegment = {
  text: string;
  start: number;
  end: number;
};

type SentenceToken = {
  text: string;
};

type TokenRange = SentenceSegment;

type DetectarGrupoOptions = {
  entries: QueismoPattern[];
  segments: SentenceSegment[];
  sourceText: string;
  globalExclusions: string[];
  matches: QueismoMatch[];
};

interface QueismoMatch extends Match {
  tipoHallazgo: HallazgoTipo;
  severidad: Confidence;
  confianza: Confidence;
  ventanaLocal: string;
  motorNlp: string | null;
}

type QueismoRule = Rule & {
  _patterns: QueismoPatterns | null;
  _nlpEngine: NlpEngine | null | undefined;
  _engineName: string | null;
  getPatterns(): QueismoPatterns;
  getNlpEngine(): NlpEngine | null;
  segmentarOraciones(texto: string): SentenceSegment[];
  tokenizarOracion(oracion: string): SentenceToken[];
  construirVentanaLocal(
    oracion: string,
    localStart: number,
    localEnd: number,
  ): string;
  esExclusion(pattern: string | undefined, text: string | undefined): boolean;
  tieneExclusion(
    entry: QueismoPattern,
    sentenceText: string,
    localWindow: string,
    globalExclusions: string[],
  ): boolean;
  normalizarConfianza(confidence: string | undefined): Confidence;
  calcularSeveridad(entry: QueismoPattern, localWindow: string): Confidence;
  detectarGrupo(options: DetectarGrupoOptions): void;
};

const DEFAULT_PATTERNS: QueismoPatterns = {
  globalExclusions: [],
  requiere_de_que: [],
  nunca_de_que: [],
};

const CONFIDENCE_ORDER: Record<Confidence, number> = {
  alta: 3,
  media: 2,
  baja: 1,
};

export const queismoRule = {
  id: "queismo",
  nombre: "Queismo y dequeismo",
  descripcion:
    "Detecta posible queismo y posible dequeismo con patrones curados y contexto local",
  color: "#f1c40f",
  _patterns: null as QueismoPatterns | null,
  _nlpEngine: undefined as NlpEngine | null | undefined,
  _engineName: null as string | null,

  detectar(texto: string): QueismoMatch[] {
    if (typeof texto !== "string" || texto.length === 0) {
      return [];
    }

    const patterns = this.getPatterns();
    const segments = this.segmentarOraciones(texto);
    const matches: QueismoMatch[] = [];

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

  getPatterns(): QueismoPatterns {
    if (this._patterns) return this._patterns;

    const url = chrome.runtime.getURL("rules/queismo/patterns.json");

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
        "[LenguajeClaro] No se pudo cargar rules/queismo/patterns.json:",
        error,
      );
    }

    this._patterns = DEFAULT_PATTERNS;
    return this._patterns;
  },

  getNlpEngine(): NlpEngine | null {
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
    return this._nlpEngine;
  },

  segmentarOraciones(texto: string): SentenceSegment[] {
    const nlp = this.getNlpEngine();

    if (nlp) {
      try {
        const doc = nlp(texto);
        const splitFn =
          typeof doc.sentences === "function"
            ? doc.sentences()
            : doc.fullSentences();
        const sentenceTexts = splitFn.out("array");
        const mapped: SentenceSegment[] = [];
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
      } catch (_) {}
    }

    const fallbackSegments: SentenceSegment[] = [];
    const regex = /[^.!?\n]+[.!?\n]?/g;
    let match: RegExpExecArray | null;

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

  tokenizarOracion(oracion: string): SentenceToken[] {
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

  construirVentanaLocal(
    oracion: string,
    localStart: number,
    localEnd: number,
  ): string {
    const tokens = this.tokenizarOracion(oracion);
    if (tokens.length === 0) {
      return oracion.slice(
        Math.max(0, localStart - 50),
        Math.min(oracion.length, localEnd + 50),
      );
    }

    const ranges: TokenRange[] = [];
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

  esExclusion(pattern: string | undefined, text: string | undefined): boolean {
    if (!pattern || !text) return false;

    try {
      const exclusionRegex = new RegExp(pattern, "i");
      return exclusionRegex.test(text);
    } catch (error) {
      return false;
    }
  },

  tieneExclusion(
    entry: QueismoPattern,
    sentenceText: string,
    localWindow: string,
    globalExclusions: string[],
  ): boolean {
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

  normalizarConfianza(confidence: string | undefined): Confidence {
    if (
      confidence === "alta" ||
      confidence === "media" ||
      confidence === "baja"
    ) {
      return confidence;
    }
    return "media";
  },

  calcularSeveridad(entry: QueismoPattern, localWindow: string): Confidence {
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

  detectarGrupo({
    entries,
    segments,
    sourceText,
    globalExclusions,
    matches,
  }: DetectarGrupoOptions): void {
    entries.forEach((entry) => {
      if (!entry || !entry.triggerPattern) return;

      let triggerRegex: RegExp;
      try {
        triggerRegex = new RegExp(entry.triggerPattern, "gi");
      } catch (_) {
        return;
      }

      segments.forEach((segment) => {
        let hit: RegExpExecArray | null;

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
          const textoOriginal = sourceText.slice(absoluteStart, absoluteEnd);
          let sugerencias: string[] = [];

          // If the pattern file provides `suggestedPattern` but not a
          // suggestion by transforming the matched text. For `queismo` entries
          // we prefer inserting "de" before "que"; for `dequeismo` entries we
          // remove an extra "de" when present.
          if (typeof entry.suggestedPattern === "string") {
            if (tipoHallazgo === "queismo") {
              sugerencias = [textoOriginal.replace(/\s+que$/i, " de que")];
            } else if (tipoHallazgo === "dequeismo") {
              sugerencias = [textoOriginal.replace(/\s+de\s+que$/i, " que")];
            }
          }

          matches.push({
            id: `${this.id}-${tipoHallazgo}-${entry.id || "pattern"}-${absoluteStart}-${absoluteEnd}`,
            inicio: absoluteStart,
            fin: absoluteEnd,
            textoOriginal,
            sugerencias,
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
} satisfies QueismoRule;

export default queismoRule;
