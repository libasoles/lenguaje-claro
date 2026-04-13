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

  recalcularPosiciones() {
    if (!this.overlayElement) return;
    if (!this.issues?.length) {
      this.renderMarkers(new Map());
      return;
    }

    const textRoot = this.getTextRoot();
    if (!textRoot) {
      console.log(
        "[Legal Docs] Highlighter: no se encontró textRoot visible",
      );
      this.renderMarkers(new Map());
      return;
    }

    const textModel = this.buildTextModel(textRoot);
    const issueRects = this.mapIssuesToRects(textModel);
    const visibleIssues = Array.from(issueRects.values()).filter(
      (rects) => rects.length > 0,
    ).length;

    console.log("[Legal Docs] Highlighter:", {
      root:
        textRoot.getAttribute("role") || textRoot.className || textRoot.tagName,
      blocks: this.getTextBlocks(textRoot).length,
      modelLength: textModel.normalizedText.length,
      issues: this.issues.length,
      visibleIssues,
    });

    this.renderMarkers(issueRects);
  },

  scheduleRecalculate() {
    if (this.recalcFrame) return;
    this.recalcFrame = requestAnimationFrame(() => {
      this.recalcFrame = 0;
      this.recalcularPosiciones();
    });
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

    this.mutationObserver = new MutationObserver(() => {
      this.scheduleRecalculate();
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
        endIndex > textModel.charMap.length;

      if (needsTextFallback) {
        const normalizedNeedle = this.normalizeText(issue.textoOriginal);
        if (!normalizedNeedle) {
          issue.rects = [];
          issue.isVisible = false;
          issueRects.set(issue.id, []);
          return;
        }

        // Search for the needle in the normalized text.
        // If we have an approximate startIndex from the pre-computed position (even if endIndex overflowed),
        // search from a window around that position to find the closest match.
        // Otherwise, search from the beginning.
        let searchStart = 0;
        if (Number.isInteger(startIndex) && startIndex >= 0) {
          // We have a partial position; search in a window around it.
          searchStart = Math.max(0, startIndex - 10);
        }

        startIndex = textModel.normalizedLower.indexOf(normalizedNeedle, searchStart);
        if (startIndex === -1) {
          issue.rects = [];
          issue.isVisible = false;
          issueRects.set(issue.id, []);
          return;
        }
        endIndex = startIndex + normalizedNeedle.length;
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
      const rects = range
        ? this.normalizeRects(Array.from(range.getClientRects()))
        : [];

      issue.rects = rects;
      issue.isVisible = rects.length > 0;
      issueRects.set(issue.id, rects);
    });

    return issueRects;
  },

  normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
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

  renderMarkers(issueRects) {
    this.currentRects = issueRects;

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
    const canApply = issue.regla === "arcaismos" && issue.sugerencia;
    const safeRuleName = this.escapeHTML(issue.reglaNombre);
    const safeDescription = this.escapeHTML(issue.descripcion);
    const safeOriginal = this.escapeHTML(issue.textoOriginal);
    const suggestionHTML =
      issue.sugerencia &&
      issue.sugerencia !== "(simplifica dividiendo en múltiples oraciones)" &&
      issue.sugerencia !== "(considera usar voz activa)"
        ? `<div class="docs-reviewer-popup-suggestion"><strong>Sugerencia:</strong> ${this.escapeHTML(issue.sugerencia)}</div>`
        : "";

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
      <div class="docs-reviewer-popup-actions">
        ${
          canApply
            ? '<button type="button" class="docs-reviewer-popup-button docs-reviewer-popup-button-primary" data-action="apply">Aplicar cambio</button>'
            : ""
        }
        <button type="button" class="docs-reviewer-popup-button" data-action="panel">Ir al panel</button>
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

  escapeHTML(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  },
};
