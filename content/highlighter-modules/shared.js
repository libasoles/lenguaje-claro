const NORMALIZED_WHITESPACE_RE =
  /[\s\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
const NORMALIZED_WHITESPACE_SEQUENCE_RE =
  /[\s\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]+/g;

export const highlighterSharedMethods = {
  esEspacioNormalizado(char) {
    return NORMALIZED_WHITESPACE_RE.test(char || "");
  },

  normalizarTextoOrigenConMapa(text) {
    const normalizedChars = [];
    const indexMap = [];
    let previousWasWhitespace = false;

    for (let index = 0; index < (text || "").length; index += 1) {
      const char = text[index];
      const isWhitespace = this.esEspacioNormalizado(char);

      if (isWhitespace) {
        if (!previousWasWhitespace) {
          normalizedChars.push(" ");
          indexMap[index] = normalizedChars.length - 1;
          previousWasWhitespace = true;
        } else {
          indexMap[index] = normalizedChars.length - 1;
        }
        continue;
      }

      normalizedChars.push(char);
      indexMap[index] = normalizedChars.length - 1;
      previousWasWhitespace = false;
    }

    return {
      normalizedText: normalizedChars.join(""),
      indexMap,
    };
  },

  normalizarTextoExacto(text) {
    return (text || "").replace(NORMALIZED_WHITESPACE_SEQUENCE_RE, " ").trim();
  },

  normalizarTexto(text) {
    return this.normalizarTextoExacto(text).toLocaleLowerCase();
  },

  rangoCoincideConTexto(normalizedText, startIndex, endIndex, needle) {
    if (
      !needle ||
      !normalizedText ||
      !Number.isInteger(startIndex) ||
      !Number.isInteger(endIndex) ||
      startIndex < 0 ||
      endIndex <= startIndex
    ) {
      return false;
    }

    return normalizedText.slice(startIndex, endIndex) === needle;
  },

  rangoCoincideConTextoExacto(normalizedText, startIndex, endIndex, needle) {
    if (
      !needle ||
      !normalizedText ||
      !Number.isInteger(startIndex) ||
      !Number.isInteger(endIndex) ||
      startIndex < 0 ||
      endIndex <= startIndex
    ) {
      return false;
    }

    return normalizedText.slice(startIndex, endIndex) === needle;
  },

  encontrarRangosTexto(haystack, needle) {
    if (!needle || !haystack) return [];

    const matches = [];
    const limit = haystack.length - needle.length;
    for (let start = 0; start <= limit; start += 1) {
      if (!haystack.startsWith(needle, start)) continue;
      matches.push({
        start,
        end: start + needle.length,
      });
    }

    return matches;
  },

  seleccionarRangoTexto(candidates, preferredStart, ordinal = null) {
    return this.seleccionarRangoTextoConOpciones(
      candidates,
      preferredStart,
      ordinal,
    );
  },

  seleccionarRangoTextoConOpciones(
    candidates,
    preferredStart,
    ordinal = null,
    options = {},
  ) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    const haystackLength = Number.isInteger(options.haystackLength)
      ? options.haystackLength
      : typeof options.haystack === "string"
        ? options.haystack.length
        : null;
    const preferredStartScope =
      options.preferredStartScope === "document" ? "document" : "local";
    const hasLocalPreferredStart =
      preferredStartScope === "local" &&
      Number.isInteger(preferredStart) &&
      preferredStart >= 0 &&
      (!Number.isInteger(haystackLength) || preferredStart <= haystackLength);

    if (hasLocalPreferredStart) {
      const exactCandidate = candidates.find(
        (candidate) => candidate.start === preferredStart,
      );
      if (exactCandidate) {
        return exactCandidate;
      }
    }

    if (
      options.allowGlobalOrdinal &&
      Number.isInteger(ordinal)
    ) {
      if (ordinal < 0 || ordinal >= candidates.length) {
        return null;
      }
      return candidates[ordinal];
    }

    const contextCandidate = this.seleccionarRangoPorContexto(
      candidates,
      options.haystack,
      options.contextBefore,
      options.contextAfter,
    );
    if (contextCandidate) {
      return contextCandidate;
    }

    if (!hasLocalPreferredStart) {
      return null;
    }

    let bestCandidate = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
      const distance = Math.abs(candidate.start - preferredStart);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidate = candidate;
      }
    });

    return bestCandidate;
  },

  seleccionarRangoPorContexto(candidates, haystack, contextBefore, contextAfter) {
    if (!Array.isArray(candidates) || !candidates.length || !haystack) {
      return null;
    }

    const beforeNeedle = this.obtenerContextoComparable(contextBefore, "before");
    const afterNeedle = this.obtenerContextoComparable(contextAfter, "after");
    if (!beforeNeedle && !afterNeedle) {
      return null;
    }

    let bestCandidate = null;
    let bestScore = 0;
    let tied = false;

    candidates.forEach((candidate) => {
      let score = 0;
      const contextPadding = 4;

      if (beforeNeedle) {
        const beforeSlice = this.normalizarTextoExacto(
          haystack.slice(
            Math.max(0, candidate.start - beforeNeedle.length - contextPadding),
            candidate.start,
          ),
        );
        if (beforeSlice.endsWith(beforeNeedle)) {
          score += beforeNeedle.length;
        }
      }

      if (afterNeedle) {
        const afterSlice = this.normalizarTextoExacto(
          haystack.slice(
            candidate.end,
            candidate.end + afterNeedle.length + contextPadding,
          ),
        );
        if (afterSlice.startsWith(afterNeedle)) {
          score += afterNeedle.length;
        }
      }

      if (score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
        tied = false;
        return;
      }

      if (score > 0 && score === bestScore) {
        tied = true;
      }
    });

    if (tied || bestScore < 4) {
      return null;
    }

    return bestCandidate;
  },

  obtenerContextoComparable(context, side) {
    const normalized = this.normalizarTextoExacto(context || "");
    if (!normalized) return "";

    const maxLength = 12;
    return side === "before"
      ? normalized.slice(-maxLength)
      : normalized.slice(0, maxLength);
  },

  obtenerOrdinalTextoIssue(issue, { caseSensitive = false } = {}) {
    if (!issue?.id) return 0;

    // Si Orchestrator precomputó el ordinal contando ocurrencias del needle
    // en el texto fuente antes del match, lo usamos: ese cómputo también
    // detecta ocurrencias que caen dentro de matches de otros issues con
    // texto distinto (ej. un needle "la sentencia..." que aparece dentro
    // de un match más largo "las partes que la sentencia...").
    const ordinalPrecomputado = caseSensitive
      ? issue.ordinalExacto
      : issue.ordinalMinusculas;
    if (Number.isInteger(ordinalPrecomputado)) {
      return ordinalPrecomputado;
    }

    const targetNeedle = caseSensitive
      ? this.normalizarTextoExacto(issue.textoOriginal)
      : this.normalizarTexto(issue.textoOriginal);
    let ordinal = 0;

    for (const candidate of this.issues || []) {
      if (candidate.id === issue.id) {
        break;
      }

      const candidateNeedle = caseSensitive
        ? this.normalizarTextoExacto(candidate.textoOriginal)
        : this.normalizarTexto(candidate.textoOriginal);
      if (candidateNeedle === targetNeedle) {
        ordinal += 1;
      }
    }

    return ordinal;
  },

  encontrarMejorRangoTexto(haystack, needle, preferredStart, options = {}) {
    const exactCandidates = this.encontrarRangosTexto(haystack, needle);
    const exactMatch = this.seleccionarRangoTextoConOpciones(
      exactCandidates,
      preferredStart,
      options.ordinal,
      {
        haystack,
        haystackLength: haystack?.length ?? null,
        contextBefore: options.contextBefore,
        contextAfter: options.contextAfter,
        allowGlobalOrdinal: Boolean(options.allowGlobalOrdinal),
        preferredStartScope: options.preferredStartScope,
      },
    );

    if (exactMatch) {
      return {
        ...exactMatch,
        matchType: options.matchType || "exact",
        candidateCount: exactCandidates.length,
      };
    }

    const flexibleMatch = this.encontrarRangoTextoFlexible(
      haystack,
      needle,
      preferredStart,
      options,
    );
    if (!flexibleMatch) {
      return null;
    }

    return {
      ...flexibleMatch,
      matchType: options.flexibleMatchType || "flexible",
    };
  },

  encontrarRangoTextoFlexible(haystack, needle, preferredStart, options = {}) {
    if (!needle || !haystack) return null;

    const tokens = needle.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;

    const escapedTokens = tokens.map((token) =>
      token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const separatorPattern = "[\\s.,;:!?\"'()\\[\\]{}-]*";
    const regex = new RegExp(escapedTokens.join(separatorPattern), "g");

    const candidates = [];
    let match;

    while ((match = regex.exec(haystack)) !== null) {
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
      });

      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }

    return this.seleccionarRangoTextoConOpciones(
      candidates,
      preferredStart,
      options.ordinal,
      {
        haystack,
        haystackLength: haystack?.length ?? null,
        contextBefore: options.contextBefore,
        contextAfter: options.contextAfter,
        allowGlobalOrdinal: Boolean(options.allowGlobalOrdinal),
        preferredStartScope: options.preferredStartScope,
      },
    );
  },

  encontrarMejorRangoEnTexto(textModel, issue, preferredStart, options = {}) {
    if (!textModel || !issue?.textoOriginal) {
      return null;
    }

    const exactNeedle = this.normalizarTextoExacto(issue.textoOriginal);
    const normalizedNeedle = this.normalizarTexto(issue.textoOriginal);
    const isDocumentModel = textModel?.scope === "document";
    const hasLocalExactOrdinal = Number.isInteger(options.localExactOrdinal);
    const hasLocalLowerOrdinal = Number.isInteger(options.localLowerOrdinal);
    const exactMatch = this.encontrarMejorRangoTexto(
      textModel.normalizedText,
      exactNeedle,
      preferredStart,
      {
        ordinal: hasLocalExactOrdinal
          ? options.localExactOrdinal
          : isDocumentModel
          ? this.obtenerOrdinalTextoIssue(issue, { caseSensitive: true })
          : null,
        contextBefore: issue.contextBeforeExact,
        contextAfter: issue.contextAfterExact,
        allowGlobalOrdinal: hasLocalExactOrdinal || isDocumentModel,
        preferredStartScope: options.preferredStartScope,
        matchType: "exact-case-sensitive",
        flexibleMatchType: "flexible-case-sensitive",
      },
    );

    if (exactMatch) {
      return exactMatch;
    }

    return this.encontrarMejorRangoTexto(
      textModel.normalizedLower,
      normalizedNeedle,
      preferredStart,
      {
        ordinal: hasLocalLowerOrdinal
          ? options.localLowerOrdinal
          : isDocumentModel
          ? this.obtenerOrdinalTextoIssue(issue, { caseSensitive: false })
          : null,
        contextBefore: issue.contextBeforeLower,
        contextAfter: issue.contextAfterLower,
        allowGlobalOrdinal: hasLocalLowerOrdinal || isDocumentModel,
        preferredStartScope: options.preferredStartScope,
        matchType: "exact-case-insensitive",
        flexibleMatchType: "flexible-case-insensitive",
      },
    );
  },

  normalizarRectangulos(rects) {
    const normalized = rects
      .filter((rect) => rect.width > 2 && rect.height > 2)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }));

    const deduped = [];
    normalized.forEach((rect) => {
      const duplicate = deduped.some(
        (existing) =>
          Math.abs(existing.left - rect.left) <= 1 &&
          Math.abs(existing.top - rect.top) <= 1 &&
          Math.abs(existing.right - rect.right) <= 1 &&
          Math.abs(existing.bottom - rect.bottom) <= 1,
      );
      if (!duplicate) deduped.push(rect);
    });

    return deduped;
  },

  contarRectangulosIssuesVisibles(issueRects) {
    if (!(issueRects instanceof Map)) return 0;

    let visibleCount = 0;
    issueRects.forEach((rects) => {
      if (Array.isArray(rects) && rects.length > 0) {
        visibleCount += 1;
      }
    });
    return visibleCount;
  },

  sincronizarIssuesConRectangulos(issueRects) {
    const rectsByIssue = issueRects instanceof Map ? issueRects : new Map();
    this.issues.forEach((issue) => {
      const rects = rectsByIssue.get(issue.id) || [];
      issue.rects = rects;
      issue.isVisible = rects.length > 0;
    });
  },

  escaparHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  },

  adivinarDireccionScroll(issue) {
    if (!issue || !this.currentRects) return 0;

    const visibleIssueIds = Array.from(this.currentRects.keys()).filter(
      (id) => this.currentRects.get(id)?.length > 0,
    );

    if (visibleIssueIds.length === 0) return 0;

    const visibleIssues = this.issues.filter((iss) =>
      visibleIssueIds.includes(iss.id),
    );
    if (visibleIssues.length === 0) return 0;

    const minStart = Math.min(...visibleIssues.map((iss) => iss.inicio));
    const maxStart = Math.max(...visibleIssues.map((iss) => iss.inicio));

    if (issue.inicio < minStart) return -1;
    if (issue.inicio > maxStart) return 1;
    return 0;
  },
};
