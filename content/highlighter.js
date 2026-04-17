const DocsHighlighter = {
  overlayElement: null,
  popupElement: null,
  issues: [],
  issueMarkers: new Map(),
  currentRects: new Map(),
  activeIssueId: null,
  pinnedIssueId: null,
  hoverIssueId: null,
  isPopupHovered: false,
  recalcFrame: 0,
  hidePopupTimer: null,
  mutationObserver: null,
  reanalysisTimer: null,
  _recalcGeneration: 0,
  _measureCanvas: null,

  inicializar() {
    if (this.overlayElement && this.popupElement) return;

    this.overlayElement = document.createElement("div");
    this.overlayElement.id = "docs-reviewer-overlay";
    this.overlayElement.className = "docs-reviewer-overlay";

    this.popupElement = document.createElement("div");
    this.popupElement.id = "docs-reviewer-popup";
    this.popupElement.className =
      "docs-reviewer-popup docs-reviewer-popup-hidden";
    this.popupElement.addEventListener("mouseenter", () => {
      this.isPopupHovered = true;
      this.cancelHidePopup();
    });
    this.popupElement.addEventListener("mouseleave", (event) => {
      this.isPopupHovered = false;
      if (!this.pinnedIssueId) {
        this.maybeHidePopup(event.relatedTarget);
      }
    });

    document.body.appendChild(this.overlayElement);
    document.body.appendChild(this.popupElement);

    window.addEventListener("resize", () => this.scheduleRecalculate());
    window.addEventListener("scroll", () => this.scheduleRecalculate(), true);
    document.addEventListener("click", (event) =>
      this.handleDocumentClick(event),
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.pinnedIssueId = null;
        DocsReviewer.limpiarIssueActivo();
      }
    });
  },

  async aplicarHighlights(allMatches) {
    this.inicializar();
    this.issues = allMatches || [];
    this.pinnedIssueId = null;
    this.hoverIssueId = null;
    this.activeIssueId = null;
    this.renderMarkers(new Map());

    // Esperar a que el textRoot esté disponible
    const textRoot = await this.waitForTextRoot();
    if (!textRoot) {
      console.log("[Legal Docs] aplicarHighlights: Could not find text root, will retry on mutation");
    }

    this.scheduleRecalculate();
    this.observeTextRoot();
  },

  limpiar() {
    this.cancelHidePopup();
    if (this.recalcFrame) {
      cancelAnimationFrame(this.recalcFrame);
      this.recalcFrame = 0;
    }
    if (this.reanalysisTimer) {
      clearTimeout(this.reanalysisTimer);
      this.reanalysisTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    this.currentRects = new Map();
    this.issueMarkers.forEach((markers) => {
      markers.forEach((marker) => marker.remove());
    });
    this.issueMarkers.clear();
    this.hidePopup();
  },

  async recalcularPosiciones() {
    if (!this.overlayElement) return;
    if (!this.issues?.length) {
      this.renderMarkers(new Map());
      return;
    }

    const generation = ++this._recalcGeneration;
    let domIssueRects = null;

    // Try DOM approach first — works when accessibility mode is enabled in GDocs.
    const textRoot = this.getTextRoot();
    if (textRoot) {
      const textModel = this.buildTextModel(textRoot);
      if (textModel.normalizedText.length > 0) {
        domIssueRects = this.mapIssuesToRects(textModel);
        const visibleIssues = this.countVisibleIssueRects(domIssueRects);
        console.log("[Legal Docs] Highlighter (DOM):", {
          root: textRoot.getAttribute("role") || textRoot.className || textRoot.tagName,
          modelLength: textModel.normalizedText.length,
          issues: this.issues.length,
          visibleIssues,
        });
        if (visibleIssues === this.issues.length) {
          if (generation === this._recalcGeneration) {
            this.renderMarkers(domIssueRects);
          }
          return;
        }

        console.log(
          "[Legal Docs] Highlighter (DOM): incomplete coverage, trying canvas fallback",
        );
      }
    }

    // Fall back to canvas-fragment approach (GDocs renders in <canvas> without accessibility mode).
    const canvasData = await this.requestCanvasFragments();
    if (generation !== this._recalcGeneration) return;

    if (!canvasData.length) {
      console.log("[Legal Docs] Highlighter: no text root and no canvas fragments");
      this.renderMarkers(domIssueRects || new Map());
      return;
    }

    const sortedFragments = this.buildSortedFragments(canvasData);
    const canvasTextModel = this.buildCanvasTextModel(sortedFragments);
    const canvasIssueRects = this.mapIssuesToRectsFromCanvas(
      sortedFragments,
      canvasTextModel,
    );
    const mergedIssueRects = this.mergeIssueRects(domIssueRects, canvasIssueRects);
    const visibleIssues = this.countVisibleIssueRects(mergedIssueRects);
    console.log("[Legal Docs] Highlighter (canvas):", {
      canvases: canvasData.length,
      fragments: sortedFragments.length,
      modelLength: canvasTextModel.normalizedText.length,
      issues: this.issues.length,
      visibleIssues,
    });
    if (generation === this._recalcGeneration) {
      this.renderMarkers(mergedIssueRects);
    }
  },

  scheduleRecalculate() {
    if (this.recalcFrame) return;
    this.recalcFrame = requestAnimationFrame(() => {
      this.recalcFrame = 0;
      this.recalcularPosiciones();
    });
  },

  scheduleReanalysis() {
    if (this.reanalysisTimer) clearTimeout(this.reanalysisTimer);
    this.reanalysisTimer = setTimeout(() => {
      this.reanalysisTimer = null;
      console.log("[Legal Docs] Re-analizando documento tras edición...");
      DocsReviewer.analizarDocumento();
    }, 2000);
  },

  setIssueActivo(issueId, options = {}) {
    this.activeIssueId = issueId;
    this.updateMarkerClasses();

    const shouldPin = Boolean(options.pinPopup && issueId);
    if (shouldPin) {
      this.pinnedIssueId = issueId;
    } else if (!options.preservePinnedPopup && this.pinnedIssueId === issueId) {
      this.pinnedIssueId = null;
    } else if (!issueId && !options.preservePinnedPopup) {
      this.pinnedIssueId = null;
    }

    if (!issueId) {
      if (!this.pinnedIssueId) {
        this.hidePopup();
      }
      return;
    }

    if (options.showPopup || shouldPin || this.hoverIssueId === issueId) {
      this.showPopup(issueId);
      return;
    }

    if (!this.pinnedIssueId) {
      this.hidePopup();
    }
  },

  focusIssue(issueId, options = {}) {
    const rects = this.currentRects.get(issueId) || [];
    if (!rects.length) {
      return false;
    }

    this.scrollRectIntoView(rects[0]);
    this.setIssueActivo(issueId, {
      ...options,
      showPopup: true,
      pinPopup: options.pinPopup !== false,
    });
    return true;
  },

  waitForTextRoot(timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        const root = this.getTextRootSync();
        if (root) {
          console.log(`[Legal Docs] waitForTextRoot: Found after ${Date.now() - startTime}ms`);
          resolve(root);
          return;
        }

        if (Date.now() - startTime > timeout) {
          console.log(`[Legal Docs] waitForTextRoot: Timeout after ${timeout}ms`);
          resolve(null);
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  },

  getTextRoot() {
    return this.getTextRootSync();
  },

  getTextRootSync() {
    // Try to find document content, not UI elements
    const candidates = [
      // Prioritize document stream view (actual content)
      '.kix-appview-editor .kix-appview-edit-container',
      '[role="main"] .kix-appview-edit-container',
      '.kix-appview-edit-container',
      '[role="list"].docos-stream-view',
      ".docos-stream-view",
      '[role="region"][aria-label*="ocument"]',
      '[role="main"] [role="document"]',
      '[role="main"] [role="textbox"]',
      '[role="document"]',
      '[role="textbox"]',
      ".kix-appview-editor",
      ".kix-appview",
    ];

    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        if (this.hasVisibleText(element)) {
          console.log(`[Legal Docs] Found text root with selector: ${selector}`);
          return element;
        }
      }
    }

    console.log("[Legal Docs] No suitable text root found");
    return null;
  },

  hasVisibleText(root) {
    if (!root) return false;

    const style = window.getComputedStyle(root);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    if (root.getAttribute?.("aria-hidden") === "true") {
      return false;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const parentStyle = window.getComputedStyle(parent);
        if (
          parentStyle.display === "none" ||
          parentStyle.visibility === "hidden" ||
          parent.getAttribute("aria-hidden") === "true"
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    return Boolean(walker.nextNode());
  },

  observeTextRoot() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    const textRoot = this.getTextRoot();
    if (!textRoot) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      // Always reposition overlays — layout may have shifted.
      this.scheduleRecalculate();

      // Fire re-analysis only for actual text content changes.
      const hasTextChange = mutations.some((mutation) => {
        if (mutation.type === "characterData") return true;
        if (mutation.type === "childList") {
          for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
            if (node.nodeType === Node.TEXT_NODE) return true;
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              node.textContent?.trim()
            ) {
              return true;
            }
          }
        }
        // attributes-only mutations are layout signals only — do NOT re-analyze.
        return false;
      });

      if (hasTextChange) {
        this.scheduleReanalysis();
      }
    });
    this.mutationObserver.observe(textRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  },

  buildTextModel(textRoot) {
    const blocks = this.getTextBlocks(textRoot);
    const entries = [];

    blocks.forEach((block, index) => {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.textContent) {
            return NodeFilter.FILTER_REJECT;
          }

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const style = window.getComputedStyle(parent);
          if (
            style.visibility === "hidden" ||
            style.display === "none" ||
            parent.getAttribute("aria-hidden") === "true"
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let currentNode;
      while ((currentNode = walker.nextNode())) {
        entries.push({
          type: "text",
          node: currentNode,
          text: currentNode.textContent,
        });
      }

      if (index < blocks.length - 1) {
        entries.push({ type: "separator", text: "\n" });
      }
    });

    const normalizedChars = [];
    const charMap = [];
    let previousWasWhitespace = false;

    entries.forEach((entry) => {
      for (let offset = 0; offset < entry.text.length; offset += 1) {
        const char = entry.text[offset];
        const isWhitespace = /\s/.test(char);

        if (isWhitespace) {
          if (!previousWasWhitespace) {
            normalizedChars.push(" ");
            charMap.push(
              entry.type === "text" ? { node: entry.node, offset } : null,
            );
            previousWasWhitespace = true;
          }
          continue;
        }

        normalizedChars.push(char);
        charMap.push(
          entry.type === "text" ? { node: entry.node, offset } : null,
        );
        previousWasWhitespace = false;
      }
    });

    const normalizedText = normalizedChars.join("");
    return {
      normalizedText,
      normalizedLower: normalizedText.toLocaleLowerCase(),
      charMap,
    };
  },

  normalizeSourceTextWithMap(text) {
    const normalizedChars = [];
    const indexMap = [];
    let previousWasWhitespace = false;

    for (let index = 0; index < (text || "").length; index += 1) {
      const char = text[index];
      const isWhitespace = /\s/.test(char);

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

  getTextBlocks(textRoot) {
    const children = Array.from(textRoot.children || []).filter((element) =>
      this.hasVisibleText(element),
    );

    if (children.length) return children;
    return [textRoot];
  },

  mapIssuesToRects(textModel) {
    const issueRects = new Map();

    this.issues.forEach((issue) => {
      let startIndex = issue.normalizedStart;
      let endIndex = issue.normalizedEnd;
      const normalizedNeedle = this.normalizeText(issue.textoOriginal);

      // Determine whether we need to run the text-based indexOf fallback.
      // Three cases require it:
      //   1. Explicit positions were never set (null/undefined) — already the original logic.
      //   2. endIndex exceeds the DOM charMap — API source text (which includes
      //      footnotes/headers/metadata) is longer than visible DOM text, so positions
      //      from later in the document overshoot. Fall back to indexOf instead of
      //      silently dropping the highlight.
      const needsTextFallback =
        startIndex === null ||
        startIndex === undefined ||
        endIndex === null ||
        endIndex === undefined ||
        endIndex > textModel.charMap.length ||
        !this.rangeMatchesNeedle(
          textModel.normalizedLower,
          startIndex,
          endIndex,
          normalizedNeedle,
        );

      if (needsTextFallback) {
        if (!normalizedNeedle) {
          issue.rects = [];
          issue.isVisible = false;
          issueRects.set(issue.id, []);
          return;
        }

        const fallbackRange = this.findBestNeedleRange(
          textModel.normalizedLower,
          normalizedNeedle,
          startIndex,
        );
        if (!fallbackRange) {
          issue.rects = [];
          issue.isVisible = false;
          issueRects.set(issue.id, []);
          return;
        }
        startIndex = fallbackRange.start;
        endIndex = fallbackRange.end;
      }

      // At this point startIndex/endIndex are resolved; reject anything still negative.
      if (startIndex < 0) {
        issue.rects = [];
        issue.isVisible = false;
        issueRects.set(issue.id, []);
        return;
      }

      const range = this.createRangeFromIndices(
        textModel.charMap,
        startIndex,
        endIndex,
      );
      let rects = range
        ? this.normalizeRects(Array.from(range.getClientRects()))
        : [];

      // If the range mapped by offsets produced no visible rects, retry by text.
      if (!rects.length && normalizedNeedle) {
        const fallbackMatch = this.findBestNeedleRange(
          textModel.normalizedLower,
          normalizedNeedle,
          startIndex,
        );

        if (
          fallbackMatch &&
          (fallbackMatch.start !== startIndex || fallbackMatch.end !== endIndex)
        ) {
          const fallbackRange = this.createRangeFromIndices(
            textModel.charMap,
            fallbackMatch.start,
            fallbackMatch.end,
          );
          rects = fallbackRange
            ? this.normalizeRects(Array.from(fallbackRange.getClientRects()))
            : [];
        }
      }

      issue.rects = rects;
      issue.isVisible = rects.length > 0;
      issueRects.set(issue.id, rects);
    });

    return issueRects;
  },

  normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  },

  rangeMatchesNeedle(normalizedText, startIndex, endIndex, needle) {
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

  findBestNeedleMatch(haystack, needle, preferredStart) {
    if (!needle || !haystack) return -1;

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let next = haystack.indexOf(needle);

    while (next !== -1) {
      const distance =
        Number.isInteger(preferredStart) && preferredStart >= 0
          ? Math.abs(next - preferredStart)
          : next;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = next;
      }
      next = haystack.indexOf(needle, next + 1);
    }

    return bestIndex;
  },

  findBestNeedleRange(haystack, needle, preferredStart) {
    const exactStart = this.findBestNeedleMatch(
      haystack,
      needle,
      preferredStart,
    );

    if (exactStart !== -1) {
      return {
        start: exactStart,
        end: exactStart + needle.length,
      };
    }

    return this.findFlexibleNeedleRange(haystack, needle, preferredStart);
  },

  findFlexibleNeedleRange(haystack, needle, preferredStart) {
    if (!needle || !haystack) return null;

    const tokens = needle.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;

    const escapedTokens = tokens.map((token) =>
      token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const separatorPattern = "[\\s.,;:!?\"'()\\[\\]{}-]*";
    const regex = new RegExp(escapedTokens.join(separatorPattern), "g");

    let bestMatch = null;
    let match;

    while ((match = regex.exec(haystack)) !== null) {
      const candidate = {
        start: match.index,
        end: match.index + match[0].length,
      };

      if (
        !bestMatch ||
        !Number.isInteger(preferredStart) ||
        preferredStart < 0 ||
        Math.abs(candidate.start - preferredStart) <
          Math.abs(bestMatch.start - preferredStart)
      ) {
        bestMatch = candidate;
      }

      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }

    return bestMatch;
  },

  createRangeFromIndices(charMap, startIndex, endIndex) {
    const startRef = this.findMappedChar(charMap, startIndex, 1);
    const endRef = this.findMappedChar(charMap, endIndex - 1, -1);

    if (!startRef || !endRef) return null;

    const range = document.createRange();
    range.setStart(startRef.node, startRef.offset);
    range.setEnd(endRef.node, endRef.offset + 1);
    return range;
  },

  findMappedChar(charMap, startIndex, direction) {
    let index = startIndex;

    while (index >= 0 && index < charMap.length) {
      if (charMap[index]) return charMap[index];
      index += direction;
    }

    return null;
  },

  normalizeRects(rects) {
    return rects
      .filter((rect) => rect.width > 2 && rect.height > 2)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }));
  },

  countVisibleIssueRects(issueRects) {
    if (!(issueRects instanceof Map)) return 0;

    let visibleCount = 0;
    issueRects.forEach((rects) => {
      if (Array.isArray(rects) && rects.length > 0) {
        visibleCount += 1;
      }
    });
    return visibleCount;
  },

  mergeIssueRects(primaryIssueRects, fallbackIssueRects) {
    if (!(primaryIssueRects instanceof Map)) {
      return fallbackIssueRects instanceof Map ? new Map(fallbackIssueRects) : new Map();
    }

    const merged = new Map(primaryIssueRects);

    if (!(fallbackIssueRects instanceof Map)) {
      return merged;
    }

    fallbackIssueRects.forEach((rects, issueId) => {
      const existingRects = merged.get(issueId);
      if (!Array.isArray(existingRects) || existingRects.length === 0) {
        merged.set(issueId, Array.isArray(rects) ? rects : []);
      }
    });

    return merged;
  },

  syncIssuesWithRects(issueRects) {
    const rectsByIssue = issueRects instanceof Map ? issueRects : new Map();
    this.issues.forEach((issue) => {
      const rects = rectsByIssue.get(issue.id) || [];
      issue.rects = rects;
      issue.isVisible = rects.length > 0;
    });
  },

  renderMarkers(issueRects) {
    this.currentRects = issueRects;
    this.syncIssuesWithRects(issueRects);

    this.issueMarkers.forEach((markers) => {
      markers.forEach((marker) => marker.remove());
    });
    this.issueMarkers.clear();

    if (!this.overlayElement) return;

    issueRects.forEach((rects, issueId) => {
      const issue = DocsReviewer.getIssue(issueId);
      if (!issue || !rects.length) return;

      const markers = rects.map((rect) => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = "docs-reviewer-highlight";
        marker.setAttribute("data-issue-id", issueId);
        marker.setAttribute("data-regla", issue.regla);
        marker.style.left = `${rect.left}px`;
        marker.style.top = `${Math.max(rect.bottom - 10, rect.top)}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${Math.max(12, Math.min(rect.height + 8, 20))}px`;
        marker.style.setProperty(
          "--docs-reviewer-highlight-color",
          issue.color,
        );

        marker.addEventListener("mouseenter", () =>
          this.handleMarkerEnter(issueId),
        );
        marker.addEventListener("mouseleave", (event) =>
          this.handleMarkerLeave(issueId, event.relatedTarget),
        );
        marker.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.handleMarkerClick(issueId);
        });

        this.overlayElement.appendChild(marker);
        return marker;
      });

      this.issueMarkers.set(issueId, markers);
    });

    this.updateMarkerClasses();

    if (this.pinnedIssueId && issueRects.get(this.pinnedIssueId)?.length) {
      this.showPopup(this.pinnedIssueId);
      return;
    }

    if (this.activeIssueId && issueRects.get(this.activeIssueId)?.length) {
      this.showPopup(this.activeIssueId);
      return;
    }

    this.hidePopup();
  },

  updateMarkerClasses() {
    this.issueMarkers.forEach((markers, issueId) => {
      markers.forEach((marker) => {
        marker.classList.toggle(
          "docs-reviewer-highlight-active",
          issueId === this.activeIssueId,
        );
        marker.classList.toggle(
          "docs-reviewer-highlight-pinned",
          issueId === this.pinnedIssueId,
        );
      });
    });
  },

  handleMarkerEnter(issueId) {
    this.hoverIssueId = issueId;
    this.cancelHidePopup();
    DocsReviewer.setIssueActivo(issueId, { showPopup: true });
  },

  handleMarkerLeave(issueId, relatedTarget) {
    if (this.hoverIssueId === issueId) {
      this.hoverIssueId = null;
    }

    if (relatedTarget?.closest?.("#docs-reviewer-popup")) {
      return;
    }

    if (!this.pinnedIssueId) {
      this.maybeHidePopup(relatedTarget);
    }
  },

  handleMarkerClick(issueId) {
    this.pinnedIssueId = issueId;
    DocsReviewer.setIssueActivo(issueId, { showPopup: true, pinPopup: true });
  },

  maybeHidePopup(relatedTarget) {
    if (this.isPopupHovered) return;
    if (relatedTarget?.closest?.("#docs-reviewer-popup")) return;
    if (this.pinnedIssueId) return;

    this.cancelHidePopup();
    this.hidePopupTimer = window.setTimeout(() => {
      if (!this.pinnedIssueId && !this.isPopupHovered) {
        DocsReviewer.limpiarIssueActivo({ preservePinnedPopup: false });
      }
    }, 120);
  },

  cancelHidePopup() {
    if (this.hidePopupTimer) {
      window.clearTimeout(this.hidePopupTimer);
      this.hidePopupTimer = null;
    }
  },

  showPopup(issueId) {
    const issue = DocsReviewer.getIssue(issueId);
    const rects = this.currentRects.get(issueId) || [];

    if (!issue || !rects.length || !this.popupElement) {
      if (!this.pinnedIssueId) {
        this.hidePopup();
      }
      return;
    }

    const triggerRect = rects[0];
    this.popupElement.innerHTML = this.renderPopupHTML(issue);
    this.popupElement.classList.remove("docs-reviewer-popup-hidden");
    this.positionPopup(triggerRect);
    requestAnimationFrame(() => {
      if (
        !this.popupElement?.classList.contains("docs-reviewer-popup-hidden")
      ) {
        this.positionPopup(triggerRect);
      }
    });
    this.bindPopupActions(issue);
  },

  renderPopupHTML(issue) {
    const PLACEHOLDER_SUGGESTIONS = [
      "(simplifica dividiendo en múltiples oraciones)",
      "(considera usar voz activa)",
    ];
    const canApply = issue.sugerencia && !PLACEHOLDER_SUGGESTIONS.includes(issue.sugerencia);
    const safeRuleName = this.escapeHTML(issue.reglaNombre);
    const safeDescription = this.escapeHTML(issue.descripcion);
    const safeOriginal = this.escapeHTML(issue.textoOriginal);
    const suggestionHTML =
      issue.sugerencia &&
      issue.sugerencia !== "(simplifica dividiendo en múltiples oraciones)" &&
      issue.sugerencia !== "(considera usar voz activa)"
        ? `<div class="docs-reviewer-popup-suggestion"><strong>Sugerencia:</strong> ${this.escapeHTML(issue.sugerencia)}</div>`
        : "";
    const logoUrl = chrome.runtime.getURL("assets/icons/logo.png");

    return `
      <div class="docs-reviewer-popup-header">
        <span class="docs-reviewer-popup-rule" style="--docs-reviewer-popup-color: ${issue.color}">${safeRuleName}</span>
        <button type="button" class="docs-reviewer-popup-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="docs-reviewer-popup-body">
        <div class="docs-reviewer-popup-description">${safeDescription}</div>
        <div class="docs-reviewer-popup-original">${safeOriginal}</div>
        ${suggestionHTML}
      </div>
      ${canApply ? `
      <div class="docs-reviewer-popup-actions">
        <button type="button" class="docs-reviewer-popup-button docs-reviewer-popup-button-primary" data-action="apply">Aplicar cambio</button>
      </div>` : ""}
      <div class="docs-reviewer-popup-footer">
        <img src="${logoUrl}" class="docs-reviewer-popup-logo" alt="">
        <button type="button" class="docs-reviewer-popup-footer-link" data-action="panel">Ver más</button>
      </div>
    `;
  },

  bindPopupActions(issue) {
    this.popupElement
      .querySelector(".docs-reviewer-popup-close")
      ?.addEventListener("click", () => {
        this.pinnedIssueId = null;
        DocsReviewer.limpiarIssueActivo();
      });

    this.popupElement
      .querySelector('[data-action="apply"]')
      ?.addEventListener("click", () => {
        DocsReviewer.aplicarCorreccion(issue.id);
      });

    this.popupElement
      .querySelector('[data-action="panel"]')
      ?.addEventListener("click", () => {
        DocsPanel.mostrar();
        DocsPanel.enfocarIssue(issue.id);
        this.pinnedIssueId = issue.id;
        DocsReviewer.setIssueActivo(issue.id, {
          showPopup: true,
          pinPopup: true,
          scrollPanel: true,
        });
      });
  },

  positionPopup(triggerRect) {
    const popupRect = this.popupElement.getBoundingClientRect();
    const margin = 12;
    let left = triggerRect.left;
    let top = triggerRect.bottom + margin;

    if (left + popupRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popupRect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    if (top + popupRect.height > window.innerHeight - margin) {
      top = triggerRect.top - popupRect.height - margin;
    }
    if (top < margin) {
      top = margin;
    }

    this.popupElement.style.left = `${left}px`;
    this.popupElement.style.top = `${top}px`;
  },

  hidePopup() {
    if (!this.popupElement) return;
    this.popupElement.classList.add("docs-reviewer-popup-hidden");
    this.popupElement.innerHTML = "";
  },

  handleDocumentClick(event) {
    if (
      event.target.closest("#docs-reviewer-popup") ||
      event.target.closest("#docs-reviewer-overlay") ||
      event.target.closest("#docs-reviewer-panel")
    ) {
      return;
    }

    this.pinnedIssueId = null;
    DocsReviewer.limpiarIssueActivo();
  },

  getScrollContainer() {
    const root = this.getTextRoot();
    let current = root;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  },

  scrollRectIntoView(rect) {
    const container = this.getScrollContainer();
    const isWindowContainer =
      container === document.scrollingElement ||
      container === document.documentElement;
    const viewportHeight = isWindowContainer
      ? window.innerHeight
      : container.clientHeight;

    if (rect.top >= 80 && rect.bottom <= viewportHeight - 80) {
      return;
    }

    const delta = rect.top - viewportHeight / 2;
    if (isWindowContainer) {
      window.scrollBy({ top: delta, behavior: "smooth" });
      return;
    }

    container.scrollBy({ top: delta, behavior: "smooth" });
  },

  // ── Canvas-based highlighting ──────────────────────────────────────────────
  // Used when GDocs renders in canvas mode (no DOM text nodes).
  // The canvas-patcher.js MAIN-world script captures fillText calls.
  // We request those fragments via CustomEvent, then map issues to viewport rects
  // by searching for the issue text in the concatenated fragment stream.

  requestCanvasFragments(timeout = 800) {
    return new Promise((resolve) => {
      const handler = (event) => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        resolve(event.detail || []);
      };
      document.addEventListener("docs-reviewer-fragments-data", handler);
      document.dispatchEvent(new Event("docs-reviewer-request-fragments"));
      setTimeout(() => {
        document.removeEventListener("docs-reviewer-fragments-data", handler);
        resolve([]);
      }, timeout);
    });
  },

  buildSortedFragments(canvasDataArray) {
    const all = [];
    for (const cd of canvasDataArray) {
      const canvasWidth = cd.canvasSize?.width || cd.canvasRect.width || 1;
      const canvasHeight = cd.canvasSize?.height || cd.canvasRect.height || 1;
      const bitmapToViewportScaleX = cd.canvasRect.width / canvasWidth;
      const bitmapToViewportScaleY = cd.canvasRect.height / canvasHeight;

      for (const frag of cd.fragments) {
        const matrix = frag.matrix || {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: 0,
          f: 0,
        };
        const baselineBitmapX = matrix.a * frag.x + matrix.c * frag.y + matrix.e;
        const baselineBitmapY = matrix.b * frag.x + matrix.d * frag.y + matrix.f;
        const scaleX =
          Math.hypot(matrix.a, matrix.b) * bitmapToViewportScaleX || 1;
        const scaleY =
          Math.hypot(matrix.c, matrix.d) * bitmapToViewportScaleY || 1;

        all.push({
          text: frag.text,
          x: frag.x,
          y: frag.y,
          font: frag.font,
          textAlign: frag.textAlign,
          textBaseline: frag.textBaseline,
          direction: frag.direction,
          matrix,
          canvasRect: cd.canvasRect,
          viewportBaselineX:
            cd.canvasRect.left + baselineBitmapX * bitmapToViewportScaleX,
          viewportBaselineY:
            cd.canvasRect.top + baselineBitmapY * bitmapToViewportScaleY,
          viewportScaleX: scaleX,
          viewportScaleY: scaleY,
        });
      }
    }
    // Sort in reading order: top-to-bottom, then left-to-right.
    all.sort((a, b) => {
      const yDiff = a.viewportBaselineY - b.viewportBaselineY;
      if (Math.abs(yDiff) > 2) return yDiff;
      return a.viewportBaselineX - b.viewportBaselineX;
    });
    return all;
  },

  buildCanvasTextModel(sortedFragments) {
    const normalizedChars = [];
    const charMap = [];
    let previousWasWhitespace = true; // start true to avoid leading space
    let previousFragment = null;

    sortedFragments.forEach((frag, fragIndex) => {
      const text = frag.text || "";

      if (
        this.shouldInsertSyntheticFragmentSpace(
          previousFragment,
          frag,
          previousWasWhitespace,
        )
      ) {
        normalizedChars.push(" ");
        charMap.push(null); // synthetic – no real canvas character position
        previousWasWhitespace = true;
      }

      for (let charOffset = 0; charOffset < text.length; charOffset += 1) {
        const char = text[charOffset];
        const isWhitespace = /\s/.test(char);

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
    };
  },

  shouldInsertSyntheticFragmentSpace(previousFragment, currentFragment, previousWasWhitespace) {
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
      this.estimateFragmentLineHeight(previousFragment) * 0.45,
      this.estimateFragmentLineHeight(currentFragment) * 0.45,
    );

    if (lineDelta > lineThreshold) {
      return true;
    }

    const previousBounds = this.getFragmentHorizontalBounds(previousFragment);
    const currentBounds = this.getFragmentHorizontalBounds(currentFragment);
    const gap = currentBounds.left - previousBounds.right;

    if (gap <= 1) {
      return false;
    }

    const spaceWidth = Math.max(
      this.measureTextWidth(" ", previousFragment.font) *
        (previousFragment.viewportScaleX || 1),
      this.measureTextWidth(" ", currentFragment.font) *
        (currentFragment.viewportScaleX || 1),
      3,
    );

    return gap >= spaceWidth * 0.45;
  },

  estimateFragmentLineHeight(frag) {
    const fontMatch = String(frag?.font || "").match(/(\d+(?:\.\d+)?)px/);
    const fontSize = fontMatch ? Number(fontMatch[1]) : 16;
    return fontSize * (frag?.viewportScaleY || 1);
  },

  getMeasureContext() {
    if (!this._measureCanvas) {
      this._measureCanvas = document.createElement("canvas");
    }

    return this._measureCanvas.getContext("2d");
  },

  measureTextWidth(text, font) {
    const ctx = this.getMeasureContext();
    ctx.font = font || ctx.font;
    return ctx.measureText(text || "").width;
  },

  getFragmentHorizontalBounds(frag) {
    const width =
      this.measureTextWidth(frag?.text || "", frag?.font) *
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

  getFragmentVerticalBounds(frag, metrics) {
    const lineHeight = Math.max(this.estimateFragmentLineHeight(frag), 1);
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

  mapIssuesToRectsFromCanvas(sortedFragments, canvasTextModel) {
    const issueRects = new Map();

    for (const issue of this.issues) {
      let startIndex = issue.normalizedStart;
      let endIndex = issue.normalizedEnd;
      const normalizedNeedle = this.normalizeText(issue.textoOriginal);
      let rects = [];

      const needsTextFallback =
        startIndex === null ||
        startIndex === undefined ||
        endIndex === null ||
        endIndex === undefined ||
        endIndex > canvasTextModel.charMap.length ||
        !this.rangeMatchesNeedle(
          canvasTextModel.normalizedLower,
          startIndex,
          endIndex,
          normalizedNeedle,
        );

      if (!needsTextFallback) {
        rects = this.computeRectsFromCanvasIndices(
          sortedFragments,
          canvasTextModel.charMap,
          startIndex,
          endIndex,
        );
      }

      if (!rects.length && normalizedNeedle) {
        const fallbackMatch = this.findBestNeedleRange(
          canvasTextModel.normalizedLower,
          normalizedNeedle,
          startIndex,
        );

        if (fallbackMatch) {
          rects = this.computeRectsFromCanvasIndices(
            sortedFragments,
            canvasTextModel.charMap,
            fallbackMatch.start,
            fallbackMatch.end,
          );
        }
      }

      issue.rects = rects;
      issue.isVisible = rects.length > 0;
      issueRects.set(issue.id, rects);
    }
    return issueRects;
  },

  computeRectsFromCanvasIndices(sortedFragments, charMap, startIndex, endIndex) {
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
        const p = fragPortions.get(fragIndex);
        p.start = Math.min(p.start, charOffset);
        p.end = Math.max(p.end, charOffset + 1);
      }
    }

    const rects = [];
    for (const [fragIndex, portion] of fragPortions) {
      const rect = this.computeFragmentPortionRect(
        sortedFragments[fragIndex],
        portion.start,
        portion.end,
      );
      if (rect) rects.push(rect);
    }

    return this.normalizeRects(rects);
  },

  computeFragmentPortionRect(frag, startChar, endChar) {
    const ctx = this.getMeasureContext();
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

    const verticalBounds = this.getFragmentVerticalBounds(frag, selMetrics);
    const top = verticalBounds.top;
    const bottom = verticalBounds.bottom;

    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  },

  // ── End canvas-based highlighting ──────────────────────────────────────────

  escapeHTML(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  },
};
