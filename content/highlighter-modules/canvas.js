import { obtenerAccionesReviewer } from "../reviewer-actions.js";

export const highlighterCanvasMethods = {
  solicitarFragmentosCanvas(options = {}) {
    const timeout = options.timeout ?? 800;
    const allowSnapshotFallback = options.allowSnapshotFallback ?? true;

    return new Promise((resolve) => {
      const handler = (event) => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        const detail = event.detail;
        if (Array.isArray(detail)) {
          resolve({
            canvasResults: detail,
            source: "legacy",
          });
          return;
        }

        resolve({
          canvasResults: Array.isArray(detail?.canvasResults)
            ? detail.canvasResults
            : [],
          source: detail?.source || "unknown",
        });
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent(
        new CustomEvent("docs-reviewer-request-fragments", {
          detail: { allowSnapshotFallback },
        }),
      );
      setTimeout(() => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        resolve({
          canvasResults: [],
          source: "timeout",
        });
      }, timeout);
    });
  },

  obtenerCanvasRectSeguro(canvasData) {
    return {
      left: canvasData?.canvasRect?.left || 0,
      top: canvasData?.canvasRect?.top || 0,
      width: canvasData?.canvasRect?.width || 1,
      height: canvasData?.canvasRect?.height || 1,
    };
  },

  compararFragmentosPorPosicion(a, b) {
    const yDiff = a.viewportBaselineY - b.viewportBaselineY;
    if (Math.abs(yDiff) > 2) return yDiff;
    return a.viewportBaselineX - b.viewportBaselineX;
  },

  deduplicarFragmentosOrdenados(sortedFragments) {
    const deduped = [];
    for (const frag of sortedFragments) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        prev.text === frag.text &&
        Math.abs(prev.viewportBaselineY - frag.viewportBaselineY) <= 2 &&
        Math.abs(prev.viewportBaselineX - frag.viewportBaselineX) <= 2
      ) {
        continue;
      }
      deduped.push(frag);
    }
    return deduped;
  },

  construirFragmentosCanvas(canvasData, canvasIndex = 0) {
    const fragments = [];
    const canvasRect = this.obtenerCanvasRectSeguro(canvasData);
    const canvasWidth = canvasData?.canvasSize?.width || canvasRect.width || 1;
    const canvasHeight = canvasData?.canvasSize?.height || canvasRect.height || 1;
    const bitmapToViewportScaleX = canvasRect.width / canvasWidth;
    const bitmapToViewportScaleY = canvasRect.height / canvasHeight;

    for (const frag of canvasData?.fragments || []) {
      const matrix = frag.matrix || {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      };
      const baselineBitmapX =
        matrix.a * frag.x + matrix.c * frag.y + matrix.e;
      const baselineBitmapY =
        matrix.b * frag.x + matrix.d * frag.y + matrix.f;
      const scaleX =
        Math.hypot(matrix.a, matrix.b) * bitmapToViewportScaleX || 1;
      const scaleY =
        Math.hypot(matrix.c, matrix.d) * bitmapToViewportScaleY || 1;

      fragments.push({
        text: frag.text,
        x: frag.x,
        y: frag.y,
        font: frag.font,
        textAlign: frag.textAlign,
        textBaseline: frag.textBaseline,
        direction: frag.direction,
        matrix,
        canvasIndex,
        canvasRect,
        canvasSize: canvasData?.canvasSize || {
          width: canvasWidth,
          height: canvasHeight,
        },
        tilePosition: canvasData?.tilePosition || null,
        viewportBaselineX:
          canvasRect.left + baselineBitmapX * bitmapToViewportScaleX,
        viewportBaselineY:
          canvasRect.top + baselineBitmapY * bitmapToViewportScaleY,
        viewportScaleX: scaleX,
        viewportScaleY: scaleY,
      });
    }

    fragments.sort((a, b) => this.compararFragmentosPorPosicion(a, b));
    return this.deduplicarFragmentosOrdenados(fragments);
  },

  construirFragmentosOrdenados(canvasDataArray) {
    const all = [];
    for (let canvasIndex = 0; canvasIndex < canvasDataArray.length; canvasIndex += 1) {
      all.push(
        ...this.construirFragmentosCanvas(
          canvasDataArray[canvasIndex],
          canvasIndex,
        ),
      );
    }

    all.sort((a, b) => {
      const yDiff = a.viewportBaselineY - b.viewportBaselineY;
      if (Math.abs(yDiff) > 2) return yDiff;
      return a.viewportBaselineX - b.viewportBaselineX;
    });

    // Google Docs renderiza cada línea de borde en los dos tiles adyacentes,
    // produciendo fragments duplicados en la misma posición viewport. Tras
    // ordenar por Y/X, colapsamos fragments consecutivos con el mismo texto
    // y posición casi idéntica (≤2px).
    return this.deduplicarFragmentosOrdenados(all);
  },

  construirModeloTextoCanvas(sortedFragments) {
    const normalizedChars = [];
    const charMap = [];
    let previousWasWhitespace = true;
    let previousFragment = null;

    sortedFragments.forEach((frag, fragIndex) => {
      const text = frag.text || "";

      if (
        this.debeInsertarEspacioSinteticoEntreFragmentos(
          previousFragment,
          frag,
          previousWasWhitespace,
        )
      ) {
        normalizedChars.push(" ");
        charMap.push(null);
        previousWasWhitespace = true;
      }

      for (let charOffset = 0; charOffset < text.length; charOffset += 1) {
        const char = text[charOffset];
        // Google Docs inserta marcas de control bidireccional (LRO/RLO/PDF/
        // isolates) alrededor de cada fragmento al renderizar en canvas.
        // No son whitespace según /\s/ pero tampoco son parte del texto
        // visible: las colapsamos como whitespace para que el texto
        // normalizado coincida con el del documento.
        const isWhitespace = this.esEspacioNormalizado
          ? this.esEspacioNormalizado(char)
          : /\s/.test(char) ||
            /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/.test(char);

        if (isWhitespace) {
          if (!previousWasWhitespace) {
            normalizedChars.push(" ");
            charMap.push({ fragIndex, charOffset });
            previousWasWhitespace = true;
          }
          continue;
        }

        normalizedChars.push(char);
        charMap.push({ fragIndex, charOffset });
        previousWasWhitespace = false;
      }

      if (text.length > 0) {
        previousFragment = frag;
      }
    });

    const normalizedText = normalizedChars.join("");
    return {
      normalizedText,
      normalizedLower: normalizedText.toLocaleLowerCase(),
      charMap,
      scope: "viewport",
    };
  },

  debeInsertarEspacioSinteticoEntreFragmentos(
    previousFragment,
    currentFragment,
    previousWasWhitespace,
  ) {
    if (
      previousWasWhitespace ||
      !previousFragment?.text ||
      !currentFragment?.text ||
      /^\s/.test(currentFragment.text)
    ) {
      return false;
    }

    const lineDelta = Math.abs(
      (currentFragment.viewportBaselineY || 0) -
        (previousFragment.viewportBaselineY || 0),
    );
    const lineThreshold = Math.max(
      3,
      this.estimarAlturaLineaFragmento(previousFragment) * 0.45,
      this.estimarAlturaLineaFragmento(currentFragment) * 0.45,
    );

    if (lineDelta > lineThreshold) {
      return true;
    }

    const previousBounds =
      this.obtenerLimitesHorizontalesFragmento(previousFragment);
    const currentBounds =
      this.obtenerLimitesHorizontalesFragmento(currentFragment);
    const gap = currentBounds.left - previousBounds.right;

    if (gap <= 1) {
      return false;
    }

    const spaceWidth = Math.max(
      this.medirAnchoTexto(" ", previousFragment.font) *
        (previousFragment.viewportScaleX || 1),
      this.medirAnchoTexto(" ", currentFragment.font) *
        (currentFragment.viewportScaleX || 1),
      3,
    );

    return gap >= spaceWidth * 0.45;
  },

  estimarAlturaLineaFragmento(frag) {
    const fontMatch = String(frag?.font || "").match(/(\d+(?:\.\d+)?)px/);
    const fontSize = fontMatch ? Number(fontMatch[1]) : 16;
    return fontSize * (frag?.viewportScaleY || 1);
  },

  obtenerContextoMedicion() {
    if (!this._measureCanvas) {
      this._measureCanvas = document.createElement("canvas");
    }

    return this._measureCanvas.getContext("2d");
  },

  medirAnchoTexto(text, font) {
    const ctx = this.obtenerContextoMedicion();
    ctx.font = font || ctx.font;
    return ctx.measureText(text || "").width;
  },

  obtenerLimitesHorizontalesFragmento(frag) {
    const width =
      this.medirAnchoTexto(frag?.text || "", frag?.font) *
      (frag?.viewportScaleX || 1);
    let left = frag?.viewportBaselineX || 0;
    let right = left + width;

    if (frag?.textAlign === "center") {
      left -= width / 2;
      right -= width / 2;
    } else if (frag?.textAlign === "right" || frag?.textAlign === "end") {
      left -= width;
      right -= width;
    }

    return { left, right };
  },

  obtenerLimitesVerticalesFragmento(frag, metrics) {
    const lineHeight = Math.max(this.estimarAlturaLineaFragmento(frag), 1);
    const ascent =
      (metrics?.actualBoundingBoxAscent || lineHeight * 0.8) *
      (frag?.viewportScaleY || 1);
    const descent =
      (metrics?.actualBoundingBoxDescent || lineHeight * 0.2) *
      (frag?.viewportScaleY || 1);
    const totalHeight = Math.max(lineHeight, ascent + descent);
    const anchorY = frag?.viewportBaselineY || 0;

    switch (frag?.textBaseline) {
      case "top":
      case "hanging":
        return {
          top: anchorY,
          bottom: anchorY + totalHeight,
        };
      case "middle":
        return {
          top: anchorY - totalHeight / 2,
          bottom: anchorY + totalHeight / 2,
        };
      case "bottom":
      case "ideographic":
        return {
          top: anchorY - totalHeight,
          bottom: anchorY,
        };
      case "alphabetic":
      default:
        return {
          top: anchorY - ascent,
          bottom: anchorY + descent,
        };
    }
  },

  obtenerFuenteNormalizada() {
    const sourceText = obtenerAccionesReviewer().sourceText;
    if (!sourceText) {
      return null;
    }

    if (this._normalizedSourceCache?.sourceText === sourceText) {
      return this._normalizedSourceCache.value;
    }

    const normalizedSource = this.normalizarTextoOrigenConMapa(sourceText);
    const cachedValue = {
      ...normalizedSource,
      normalizedLower: normalizedSource.normalizedText.toLocaleLowerCase(),
    };

    this._normalizedSourceCache = {
      sourceText,
      value: cachedValue,
    };

    return cachedValue;
  },

  construirAnclasViewport(viewportText) {
    if (!viewportText) {
      return [];
    }

    const anchors = [];
    const seenOffsets = new Set();
    const minAnchorLength = Math.min(16, viewportText.length);
    const addAnchor = (offset) => {
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset >= viewportText.length ||
        seenOffsets.has(offset)
      ) {
        return;
      }

      const anchorLength = Math.min(64, viewportText.length - offset);
      const anchorText = viewportText.slice(offset, offset + anchorLength);
      if (
        anchorLength < minAnchorLength ||
        this.normalizarTextoExacto(anchorText).length <
          Math.min(8, minAnchorLength)
      ) {
        return;
      }

      seenOffsets.add(offset);
      anchors.push({
        offset,
        text: anchorText,
      });
    };

    addAnchor(0);

    // Prefer long words (≥8 chars) throughout the viewport — more likely unique in source
    const longWordRegex = /\S{8,}/g;
    let match;
    while ((match = longWordRegex.exec(viewportText)) !== null) {
      addAnchor(match.index);
      if (anchors.length >= 6) break;
    }

    // Fallback: short tokens from the first 96 chars of the viewport
    const tokenRegex = /\S+/g;
    while ((match = tokenRegex.exec(viewportText)) !== null) {
      if (match.index > 96) break;
      addAnchor(match.index);
      if (anchors.length >= 8) break;
    }

    return anchors;
  },

  resolverInicioViewportEnDocumento(canvasTextModel, normalizedSource) {
    const viewportText = canvasTextModel?.normalizedText;
    const sourceText = normalizedSource?.normalizedText;
    if (!viewportText || !sourceText) {
      return null;
    }

    const anchors = this.construirAnclasViewport(viewportText);
    for (const anchor of anchors) {
      const matches = this.encontrarRangosTexto(sourceText, anchor.text);
      if (matches.length !== 1) {
        continue;
      }

      const viewportDocStart = matches[0].start - anchor.offset;
      if (viewportDocStart < 0) {
        continue;
      }

      if (
        sourceText.slice(viewportDocStart, viewportDocStart + viewportText.length) !==
        viewportText
      ) {
        continue;
      }

      return viewportDocStart;
    }

    return null;
  },

  obtenerTextoBuscableModeloCanvas(canvasModel) {
    const text = canvasModel?.normalizedText || "";
    let start = 0;
    let end = text.length;

    while (start < end && text[start] === " ") start += 1;
    while (end > start && text[end - 1] === " ") end -= 1;

    return {
      text: text.slice(start, end),
      localStart: start,
      localEnd: end,
    };
  },

  obtenerPosicionOrdenCanvas(canvasModel) {
    const topPx = canvasModel?.tilePosition?.topPx;
    const leftPx = canvasModel?.tilePosition?.leftPx;
    return {
      top: Number.isFinite(topPx) ? topPx : canvasModel?.canvasRect?.top || 0,
      left: Number.isFinite(leftPx) ? leftPx : canvasModel?.canvasRect?.left || 0,
    };
  },

  compararModelosCanvas(a, b) {
    const posA = this.obtenerPosicionOrdenCanvas(a);
    const posB = this.obtenerPosicionOrdenCanvas(b);
    const topDiff = posA.top - posB.top;
    if (Math.abs(topDiff) > 2) return topDiff;
    return posA.left - posB.left;
  },

  asignarRangoDocumentoCanvas(canvasModel, docStart, confidence, sourceLength) {
    if (!Number.isInteger(docStart) || docStart < 0) {
      canvasModel.docStart = null;
      canvasModel.docEnd = null;
      canvasModel.confidence = "ambiguous";
      return false;
    }

    canvasModel.docStart = docStart;
    canvasModel.docEnd = Math.min(
      sourceLength,
      docStart + (canvasModel.normalizedText || "").length,
    );
    canvasModel.confidence = confidence;
    return true;
  },

  resolverRangoCanvasPorCoincidenciaExacta(canvasModel, normalizedSource) {
    const sourceText = normalizedSource?.normalizedText || "";
    const searchable = this.obtenerTextoBuscableModeloCanvas(canvasModel);
    if (!sourceText || searchable.text.length < 4) {
      canvasModel.candidateDocStarts = [];
      return false;
    }

    const matches = this.encontrarRangosTexto(sourceText, searchable.text);
    const candidateStarts = matches
      .map((match) => match.start - searchable.localStart)
      .filter((start) => start >= 0);
    const exactCandidates = candidateStarts.filter(
      (start) =>
        sourceText.slice(
          start,
          start + (canvasModel.normalizedText || "").length,
        ) === canvasModel.normalizedText,
    );

    canvasModel.candidateDocStarts = exactCandidates.length
      ? exactCandidates
      : candidateStarts;

    if (exactCandidates.length === 1) {
      return this.asignarRangoDocumentoCanvas(
        canvasModel,
        exactCandidates[0],
        "exact",
        sourceText.length,
      );
    }

    if (candidateStarts.length === 1) {
      return this.asignarRangoDocumentoCanvas(
        canvasModel,
        candidateStarts[0],
        "exact-trimmed",
        sourceText.length,
      );
    }

    return false;
  },

  resolverRangoCanvasPorAnclas(canvasModel, normalizedSource) {
    const sourceText = normalizedSource?.normalizedText || "";
    if (!sourceText || !canvasModel?.normalizedText) return false;

    const anchors = this.construirAnclasViewport(canvasModel.normalizedText);
    const candidatesByStart = new Map();

    anchors.forEach((anchor) => {
      const matches = this.encontrarRangosTexto(sourceText, anchor.text);
      if (matches.length !== 1) return;

      const docStart = matches[0].start - anchor.offset;
      if (docStart < 0) return;

      const current = candidatesByStart.get(docStart) || {
        count: 0,
        maxAnchorLength: 0,
      };
      current.count += 1;
      current.maxAnchorLength = Math.max(
        current.maxAnchorLength,
        anchor.text.length,
      );
      candidatesByStart.set(docStart, current);
    });

    let bestStart = null;
    let bestScore = null;
    let tied = false;

    candidatesByStart.forEach((score, docStart) => {
      if (
        !bestScore ||
        score.count > bestScore.count ||
        (score.count === bestScore.count &&
          score.maxAnchorLength > bestScore.maxAnchorLength)
      ) {
        bestStart = docStart;
        bestScore = score;
        tied = false;
        return;
      }

      if (
        bestScore &&
        score.count === bestScore.count &&
        score.maxAnchorLength === bestScore.maxAnchorLength
      ) {
        tied = true;
      }
    });

    if (
      bestStart === null ||
      tied ||
      (bestScore.count < 2 && bestScore.maxAnchorLength < 24)
    ) {
      return false;
    }

    return this.asignarRangoDocumentoCanvas(
      canvasModel,
      bestStart,
      "anchored",
      sourceText.length,
    );
  },

  obtenerVecinoResuelto(modelosOrdenados, index, direction) {
    for (
      let cursor = index + direction;
      cursor >= 0 && cursor < modelosOrdenados.length;
      cursor += direction
    ) {
      const candidate = modelosOrdenados[cursor];
      if (
        Number.isInteger(candidate?.docStart) &&
        Number.isInteger(candidate?.docEnd) &&
        candidate.confidence !== "ambiguous"
      ) {
        return candidate;
      }
    }

    return null;
  },

  resolverRangoCanvasPorVecinos(canvasModel, modelosOrdenados, index, sourceLength) {
    const candidates = Array.isArray(canvasModel.candidateDocStarts)
      ? canvasModel.candidateDocStarts
      : [];
    if (!candidates.length) return false;

    const previous = this.obtenerVecinoResuelto(modelosOrdenados, index, -1);
    const next = this.obtenerVecinoResuelto(modelosOrdenados, index, 1);
    if (!previous && !next) return false;

    const minStart = previous ? previous.docStart : Number.NEGATIVE_INFINITY;
    const maxStart = next ? next.docStart : Number.POSITIVE_INFINITY;
    const bounded = candidates.filter(
      (start) => start >= minStart && start <= maxStart,
    );

    if (bounded.length === 1) {
      return this.asignarRangoDocumentoCanvas(
        canvasModel,
        bounded[0],
        "neighbor",
        sourceLength,
      );
    }

    if (!bounded.length) return false;

    let bestStart = bounded[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    bounded.forEach((start) => {
      const previousDistance = previous
        ? Math.abs(start - previous.docEnd)
        : Number.POSITIVE_INFINITY;
      const nextDistance = next
        ? Math.abs(next.docStart - start)
        : Number.POSITIVE_INFINITY;
      const distance = Math.min(previousDistance, nextDistance);
      if (distance < bestDistance) {
        bestStart = start;
        bestDistance = distance;
      }
    });

    return this.asignarRangoDocumentoCanvas(
      canvasModel,
      bestStart,
      "neighbor",
      sourceLength,
    );
  },

  resolverRangosModelosCanvas(modelosOrdenados, normalizedSource) {
    const sourceLength = normalizedSource?.normalizedText?.length || 0;
    if (!sourceLength) {
      modelosOrdenados.forEach((model) => {
        model.docStart = null;
        model.docEnd = null;
        model.confidence = "ambiguous";
        model.candidateDocStarts = [];
      });
      return modelosOrdenados;
    }

    modelosOrdenados.forEach((model) => {
      model.docStart = null;
      model.docEnd = null;
      model.confidence = "ambiguous";
      this.resolverRangoCanvasPorCoincidenciaExacta(model, normalizedSource) ||
        this.resolverRangoCanvasPorAnclas(model, normalizedSource);
    });

    modelosOrdenados.forEach((model, index) => {
      if (model.confidence !== "ambiguous") return;
      this.resolverRangoCanvasPorVecinos(
        model,
        modelosOrdenados,
        index,
        sourceLength,
      );
    });

    return modelosOrdenados;
  },

  construirModelosTextoPorCanvas(canvasDataArray) {
    const modelos = [];

    for (let canvasIndex = 0; canvasIndex < canvasDataArray.length; canvasIndex += 1) {
      const canvasData = canvasDataArray[canvasIndex];
      const fragments = this.construirFragmentosCanvas(canvasData, canvasIndex);
      const textModel = this.construirModeloTextoCanvas(fragments);
      if (!textModel.normalizedText) continue;

      modelos.push({
        ...textModel,
        scope: "canvas",
        canvasIndex,
        canvasRect: this.obtenerCanvasRectSeguro(canvasData),
        canvasSize: canvasData?.canvasSize || null,
        tilePosition: canvasData?.tilePosition || null,
        fragments,
        docStart: null,
        docEnd: null,
        confidence: "ambiguous",
        candidateDocStarts: [],
      });
    }

    modelos.sort((a, b) => this.compararModelosCanvas(a, b));
    return this.resolverRangosModelosCanvas(
      modelos,
      this.obtenerFuenteNormalizada(),
    );
  },

  obtenerVentanaDocumentoVisibleDesdeCanvasModels(canvasModels) {
    const resolved = (canvasModels || []).filter(
      (model) =>
        Number.isInteger(model?.docStart) &&
        Number.isInteger(model?.docEnd) &&
        model.docEnd > model.docStart &&
        model.confidence !== "ambiguous",
    );

    if (!resolved.length) return null;

    return {
      minDocStart: Math.min(...resolved.map((model) => model.docStart)),
      maxDocEnd: Math.max(...resolved.map((model) => model.docEnd)),
      resolvedCanvasCount: resolved.length,
    };
  },

  contarOcurrenciasAntesDePosicion(haystack, needle, endIndex, cache = null) {
    if (
      !haystack ||
      !needle ||
      !Number.isInteger(endIndex) ||
      endIndex <= 0 ||
      needle.length > haystack.length
    ) {
      return 0;
    }

    const cacheKey = `${endIndex}:${needle}`;
    if (cache?.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    let count = 0;
    const maxStart = Math.min(endIndex - 1, haystack.length - needle.length);
    for (let start = 0; start <= maxStart; start += 1) {
      if (haystack.startsWith(needle, start)) {
        count += 1;
      }
    }

    cache?.set(cacheKey, count);
    return count;
  },

  calcularOrdinalLocalViewport(
    issue,
    normalizedSource,
    viewportDocStart,
    { caseSensitive = false, cache = null } = {},
  ) {
    const globalOrdinal = caseSensitive
      ? issue?.ordinalExacto
      : issue?.ordinalMinusculas;
    if (!Number.isInteger(globalOrdinal) || !Number.isInteger(viewportDocStart)) {
      return null;
    }

    const haystack = caseSensitive
      ? normalizedSource?.normalizedText
      : normalizedSource?.normalizedLower;
    const needle = caseSensitive
      ? this.normalizarTextoExacto(issue?.textoOriginal)
      : this.normalizarTexto(issue?.textoOriginal);
    if (!haystack || !needle) {
      return null;
    }

    return (
      globalOrdinal -
      this.contarOcurrenciasAntesDePosicion(
        haystack,
        needle,
        viewportDocStart,
        cache,
      )
    );
  },

  obtenerRangoNormalizadoIssue(issue) {
    if (
      Number.isInteger(issue?.normalizedStart) &&
      Number.isInteger(issue?.normalizedEnd) &&
      issue.normalizedEnd > issue.normalizedStart
    ) {
      return {
        start: issue.normalizedStart,
        end: issue.normalizedEnd,
      };
    }

    return null;
  },

  rangosIntersectan(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
  },

  modeloCanvasTieneRangoDocumento(canvasModel) {
    return (
      Number.isInteger(canvasModel?.docStart) &&
      Number.isInteger(canvasModel?.docEnd) &&
      canvasModel.docEnd > canvasModel.docStart &&
      canvasModel.confidence !== "ambiguous"
    );
  },

  rangoIssueCompletoCoincideConModelo(canvasModel, issue, localStart, localEnd) {
    const exactNeedle = this.normalizarTextoExacto(issue?.textoOriginal);
    const normalizedNeedle = this.normalizarTexto(issue?.textoOriginal);
    if (!exactNeedle || !normalizedNeedle) return false;

    return (
      canvasModel.normalizedText.slice(localStart, localEnd) === exactNeedle &&
      canvasModel.normalizedLower.slice(localStart, localEnd) ===
        normalizedNeedle
    );
  },

  rangoCanvasCoincideConFuenteNormalizada(
    canvasModel,
    normalizedSource,
    localStart,
    localEnd,
  ) {
    if (!this.modeloCanvasTieneRangoDocumento(canvasModel)) return false;
    if (
      !Number.isInteger(localStart) ||
      !Number.isInteger(localEnd) ||
      localEnd <= localStart
    ) {
      return false;
    }

    const sourceLower = normalizedSource?.normalizedLower || "";
    const globalStart = canvasModel.docStart + localStart;
    const globalEnd = canvasModel.docStart + localEnd;
    if (globalStart < 0 || globalEnd > sourceLower.length) {
      return false;
    }

    const canvasSliceLower = canvasModel.normalizedLower.slice(
      localStart,
      localEnd,
    );
    const sourceSliceLower = sourceLower.slice(globalStart, globalEnd);
    return canvasSliceLower.length > 0 && canvasSliceLower === sourceSliceLower;
  },

  encontrarRangoSeguroEnModeloCanvas(
    canvasModel,
    issue,
    { allowUnique = false } = {},
  ) {
    const exactNeedle = this.normalizarTextoExacto(issue?.textoOriginal);
    const normalizedNeedle = this.normalizarTexto(issue?.textoOriginal);
    if (!exactNeedle || !normalizedNeedle) return null;

    const exactCandidates = this.encontrarRangosTexto(
      canvasModel.normalizedText,
      exactNeedle,
    );
    const exactContextMatch = this.seleccionarRangoPorContexto(
      exactCandidates,
      canvasModel.normalizedText,
      issue.contextBeforeExact,
      issue.contextAfterExact,
    );
    if (exactContextMatch) return exactContextMatch;
    if (allowUnique && exactCandidates.length === 1) return exactCandidates[0];

    const lowerCandidates = this.encontrarRangosTexto(
      canvasModel.normalizedLower,
      normalizedNeedle,
    );
    const lowerContextMatch = this.seleccionarRangoPorContexto(
      lowerCandidates,
      canvasModel.normalizedLower,
      issue.contextBeforeLower,
      issue.contextAfterLower,
    );
    if (lowerContextMatch) return lowerContextMatch;
    if (allowUnique && lowerCandidates.length === 1) return lowerCandidates[0];

    return null;
  },

  calcularRectangulosIssueEnModeloCanvas(
    canvasModel,
    issue,
    normalizedSource,
    caches,
  ) {
    const resolved = this.modeloCanvasTieneRangoDocumento(canvasModel);
    const issueRange = this.obtenerRangoNormalizadoIssue(issue);
    let rects = [];

    if (resolved && issueRange) {
      const intersects = this.rangosIntersectan(
        issueRange.start,
        issueRange.end,
        canvasModel.docStart,
        canvasModel.docEnd,
      );

      if (!intersects) return [];

      const globalStart = Math.max(issueRange.start, canvasModel.docStart);
      const globalEnd = Math.min(issueRange.end, canvasModel.docEnd);
      const localStart = globalStart - canvasModel.docStart;
      const localEnd = globalEnd - canvasModel.docStart;
      const fullIssueInside =
        issueRange.start >= canvasModel.docStart &&
        issueRange.end <= canvasModel.docEnd;
      const canUseDocumentRange =
        localEnd > localStart &&
        localEnd <= canvasModel.charMap.length &&
        this.rangoCanvasCoincideConFuenteNormalizada(
          canvasModel,
          normalizedSource,
          localStart,
          localEnd,
        ) &&
        (!fullIssueInside ||
          this.rangoIssueCompletoCoincideConModelo(
            canvasModel,
            issue,
            localStart,
            localEnd,
          ));

      if (canUseDocumentRange) {
        rects = this.calcularRectangulosDesdeIndicesCanvas(
          canvasModel.fragments,
          canvasModel.charMap,
          localStart,
          localEnd,
        );
      }

      if (!rects.length && fullIssueInside) {
        const localExactOrdinal = this.calcularOrdinalLocalViewport(
          issue,
          normalizedSource,
          canvasModel.docStart,
          {
            caseSensitive: true,
            cache: caches.exactOrdinal,
          },
        );
        const localLowerOrdinal = this.calcularOrdinalLocalViewport(
          issue,
          normalizedSource,
          canvasModel.docStart,
          {
            cache: caches.lowerOrdinal,
          },
        );
        const fallbackMatch = this.encontrarMejorRangoEnTexto(
          canvasModel,
          issue,
          localStart,
          {
            preferredStartScope: "local",
            localExactOrdinal,
            localLowerOrdinal,
          },
        );

        if (fallbackMatch) {
          rects = this.calcularRectangulosDesdeIndicesCanvas(
            canvasModel.fragments,
            canvasModel.charMap,
            fallbackMatch.start,
            fallbackMatch.end,
          );
        }
      }

      return rects;
    }

    const safeLocalMatch = this.encontrarRangoSeguroEnModeloCanvas(canvasModel, issue, {
      allowUnique: !issueRange,
    });
    if (!safeLocalMatch) return [];

    return this.calcularRectangulosDesdeIndicesCanvas(
      canvasModel.fragments,
      canvasModel.charMap,
      safeLocalMatch.start,
      safeLocalMatch.end,
    );
  },

  mapearIssuesARectangulosDesdeModelosCanvas(canvasModels) {
    const issueRects = new Map();
    const normalizedSource = this.obtenerFuenteNormalizada();
    const caches = {
      exactOrdinal: new Map(),
      lowerOrdinal: new Map(),
    };
    const debugMatching = obtenerAccionesReviewer()._debugMatching === true;

    for (const issue of this.issues) {
      let rects = [];

      for (const canvasModel of canvasModels || []) {
        rects.push(
          ...this.calcularRectangulosIssueEnModeloCanvas(
            canvasModel,
            issue,
            normalizedSource,
            caches,
          ),
        );
      }

      rects = this.filtrarRectangulosFueraDelEditor(
        this.normalizarRectangulos(rects),
      );

      if (debugMatching && !rects.length) {
        console.log("[Docs Reviewer] issue sin rects:", {
          id: issue.id,
          texto: issue.textoOriginal?.slice(0, 40),
          visibleDocRange: this.obtenerVentanaDocumentoVisibleDesdeCanvasModels(
            canvasModels,
          ),
        });
      }

      issue.rects = rects;
      issue.isVisible = rects.length > 0;
      issueRects.set(issue.id, rects);
    }

    return issueRects;
  },

  construirModeloCanvasLegacy(sortedFragments, canvasTextModel) {
    const canvasRect = sortedFragments?.[0]?.canvasRect || null;
    const legacyModel = {
      ...canvasTextModel,
      scope: "canvas",
      canvasIndex: 0,
      canvasRect,
      canvasSize: null,
      tilePosition: null,
      fragments: sortedFragments || [],
      docStart: null,
      docEnd: null,
      confidence: "ambiguous",
      candidateDocStarts: [],
    };

    if (canvasTextModel?.scope === "document") {
      legacyModel.docStart = 0;
      legacyModel.docEnd = canvasTextModel.normalizedText?.length || 0;
      legacyModel.confidence = "document";
      return legacyModel;
    }

    this.resolverRangosModelosCanvas(
      [legacyModel],
      this.obtenerFuenteNormalizada(),
    );
    return legacyModel;
  },

  mapearIssuesARectangulosDesdeCanvas(sortedFragmentsOrModels, canvasTextModel) {
    if (
      Array.isArray(sortedFragmentsOrModels) &&
      sortedFragmentsOrModels.every((item) => item?.scope === "canvas")
    ) {
      return this.mapearIssuesARectangulosDesdeModelosCanvas(
        sortedFragmentsOrModels,
      );
    }

    if (Array.isArray(canvasTextModel)) {
      return this.mapearIssuesARectangulosDesdeModelosCanvas(canvasTextModel);
    }

    const legacyModel = this.construirModeloCanvasLegacy(
      sortedFragmentsOrModels,
      canvasTextModel,
    );
    return this.mapearIssuesARectangulosDesdeModelosCanvas([legacyModel]);
  },

  obtenerRectEditor() {
    const editor = document.querySelector(".kix-appview-editor");
    if (!editor) return null;
    const r = editor.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return r;
  },

  filtrarRectangulosFueraDelEditor(rects) {
    if (!rects?.length) return rects;
    const editorRect = this.obtenerRectEditor();
    if (!editorRect) return rects;
    return rects.filter((rect) => {
      return rect.bottom > editorRect.top && rect.top < editorRect.bottom;
    });
  },

  calcularRectangulosDesdeIndicesCanvas(
    sortedFragments,
    charMap,
    startIndex,
    endIndex,
  ) {
    if (!Array.isArray(charMap) || startIndex < 0 || endIndex <= startIndex) {
      return [];
    }

    const fragPortions = new Map();
    for (let ci = startIndex; ci < endIndex; ci++) {
      const ref = charMap[ci];
      if (!ref) continue;
      const { fragIndex, charOffset } = ref;
      if (!fragPortions.has(fragIndex)) {
        fragPortions.set(fragIndex, { start: charOffset, end: charOffset + 1 });
      } else {
        const portion = fragPortions.get(fragIndex);
        portion.start = Math.min(portion.start, charOffset);
        portion.end = Math.max(portion.end, charOffset + 1);
      }
    }

    const rects = [];
    for (const [fragIndex, portion] of fragPortions) {
      const rect = this.calcularRectanguloPorcionFragmento(
        sortedFragments[fragIndex],
        portion.start,
        portion.end,
      );
      if (rect) rects.push(rect);
    }

    return this.normalizarRectangulos(rects);
  },

  calcularRectanguloPorcionFragmento(frag, startChar, endChar) {
    const ctx = this.obtenerContextoMedicion();
    ctx.font = frag.font;

    const prefix = frag.text.substring(0, startChar);
    const selected = frag.text.substring(startChar, endChar);
    if (!selected) return null;

    const prefixWidth = ctx.measureText(prefix).width;
    const selMetrics = ctx.measureText(selected);
    const selWidth = selMetrics.width;
    const scaleX = frag.viewportScaleX || 1;

    let left = frag.viewportBaselineX + prefixWidth * scaleX;
    let right = left + selWidth * scaleX;

    if (frag.textAlign === "center") {
      const fullWidth = ctx.measureText(frag.text).width * scaleX;
      left -= fullWidth / 2;
      right -= fullWidth / 2;
    } else if (frag.textAlign === "right" || frag.textAlign === "end") {
      const fullWidth = ctx.measureText(frag.text).width * scaleX;
      left -= fullWidth;
      right -= fullWidth;
    }

    const verticalBounds = this.obtenerLimitesVerticalesFragmento(
      frag,
      selMetrics,
    );
    const top = verticalBounds.top;
    const bottom = verticalBounds.bottom;

    if (right - left < 1 || bottom - top < 1) return null;
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  },
};
