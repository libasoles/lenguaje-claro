const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const patterns = require(path.join(projectRoot, "rules", "patterns.json"));

async function launchBrowserOrSkip(t) {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(
      `Playwright no disponible en este entorno: ${error.message.split("\n")[0]}`,
    );
    return null;
  }
}

test("renderiza el panel con hallazgos, sugerencias y botones", async (t) => {
  const browser = await launchBrowserOrSkip(t);
  if (!browser) return;

  t.after(async () => {
    await browser.close();
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  t.after(async () => {
    await context.close();
  });

  const sampleDocText = [
    "In fine, corresponde resolver.",
    "Fue interpuesto el recurso por la actora.",
    "Hay que darse cuenta que esto importa.",
  ].join(" ");

  await page.route(
    "https://docs.google.com/document/d/test-doc",
    async (route) => {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Fixture Google Docs</title>
    <style>
      body {
        margin: 0;
        font-family: sans-serif;
        background: #f6f8fc;
      }

      main {
        min-height: 100vh;
        padding: 48px;
      }

      .fixture-doc {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px;
        border-radius: 16px;
        background: white;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
    </style>
  </head>
  <body>
    <main role="main">
      <section class="fixture-doc">
        <h1>Documento de prueba</h1>
        <p>El contenido textual lo entrega el stub de DocsReader.</p>
      </section>
    </main>
  </body>
</html>`,
      });
    },
  );

  await page.addInitScript((docText) => {
    const buildSegments = (text) => [
      {
        apiStart: 1,
        apiEnd: text.length + 1,
        strStart: 0,
        length: text.length,
      },
    ];

    window.__docsReviewerTestState = {
      docText,
      readCalls: 0,
      sentMessages: [],
      failNextReadWithInvalidatedContext: false,
      unhandledErrors: [],
      unhandledRejections: [],
    };

    window.addEventListener("error", (event) => {
      window.__docsReviewerTestState.unhandledErrors.push(event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__docsReviewerTestState.unhandledRejections.push(
        event.reason?.message || String(event.reason),
      );
    });

    window.chrome = {
      runtime: {
        lastError: null,
        getURL(resourcePath) {
          if (resourcePath.endsWith(".svg")) {
            return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
          }

          return resourcePath;
        },
        sendMessage(message, callback) {
          window.__docsReviewerTestState.sentMessages.push(message);

          if (message.type === "GET_DOC_TEXT") {
            callback({
              text: window.__docsReviewerTestState.docText,
              segments: buildSegments(window.__docsReviewerTestState.docText),
            });
            return;
          }

          if (message.type === "APPLY_REPLACEMENT") {
            callback({ success: true });
            return;
          }

          callback({ error: `Unsupported message type: ${message.type}` });
        },
      },
    };

    var DocsReader = (window.DocsReader = {
      lastReadError: null,
      getDocumentId() {
        const match = window.location.href.match(
          /\/document\/d\/([a-zA-Z0-9_-]+)/,
        );
        return match ? match[1] : null;
      },
      esperarDocumentoListo() {
        return Promise.resolve(Boolean(this.getDocumentId()));
      },
      leerDocumento() {
        window.__docsReviewerTestState.readCalls += 1;

        if (window.__docsReviewerTestState.failNextReadWithInvalidatedContext) {
          window.__docsReviewerTestState.failNextReadWithInvalidatedContext = false;
          this.lastReadError = {
            code: "EXTENSION_CONTEXT_INVALIDATED",
            message:
              "La extensión se actualizó. Recargá la página para continuar.",
          };
          return Promise.resolve(null);
        }

        this.lastReadError = null;
        return Promise.resolve({
          text: window.__docsReviewerTestState.docText,
          segments: buildSegments(window.__docsReviewerTestState.docText),
        });
      },
    });

    var DocsHighlighter = (window.DocsHighlighter = {
      activeIssueId: null,
      issues: [],
      inicializar() {},
      limpiar() {
        this.issues = [];
        this.activeIssueId = null;
      },
      normalizeSourceTextWithMap(sourceText) {
        return {
          normalizedText: sourceText,
          indexMap: Array.from(sourceText, (_, index) => index),
        };
      },
      async aplicarHighlights(allMatches) {
        this.issues = allMatches;
      },
      setIssueActivo(issueId) {
        this.activeIssueId = issueId;
      },
      focusIssue(issueId) {
        this.activeIssueId = issueId;
        return true;
      },
    });
  }, sampleDocText);

  await page.goto("https://docs.google.com/document/d/test-doc");
  await page.addStyleTag({
    path: path.join(projectRoot, "panel", "panel.css"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "rules", "index.js"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "rules", "arcaismos.js"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "rules", "voz-pasiva.js"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "rules", "queismo.js"),
  });
  await page.evaluate((nextPatterns) => {
    const rule = window.docsReviewerRules.find((item) => item.id === "queismo");
    rule._patterns = nextPatterns;
    rule.getPatterns = () => nextPatterns;
    rule.getNlpEngine = () => null;
    rule._engineName = "fallback";
  }, patterns);
  await page.addScriptTag({
    path: path.join(projectRoot, "content", "runtime.js"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "content", "panel.js"),
  });
  await page.addScriptTag({
    path: path.join(projectRoot, "content", "content.js"),
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".docs-reviewer-issue").length === 3,
  );

  const initialState = await page.evaluate(() => {
    const panel = document.getElementById("docs-reviewer-panel");
    const issues = Array.from(
      document.querySelectorAll(".docs-reviewer-issue"),
    ).map((element) => ({
      rule: element
        .querySelector(".docs-reviewer-issue-regla")
        ?.textContent?.trim(),
      description: element
        .querySelector(".docs-reviewer-issue-texto")
        ?.textContent?.trim(),
      suggestion: element
        .querySelector(".docs-reviewer-issue-sugerencia")
        ?.textContent?.trim(),
      button: element
        .querySelector(".docs-reviewer-issue-button")
        ?.textContent?.trim(),
    }));

    return {
      panelExists: Boolean(panel),
      panelVisible: panel
        ? window.getComputedStyle(panel).display !== "none"
        : false,
      headerButtons: {
        reanalyze: Boolean(document.getElementById("docs-reviewer-reanalizar")),
        close: Boolean(document.getElementById("docs-reviewer-close")),
      },
      issueCount: issues.length,
      issues,
      readCalls: window.__docsReviewerTestState.readCalls,
      sentMessages: window.__docsReviewerTestState.sentMessages.slice(),
    };
  });

  assert.equal(initialState.panelExists, true);
  assert.equal(initialState.panelVisible, true);
  assert.deepEqual(initialState.headerButtons, {
    reanalyze: true,
    close: true,
  });
  assert.equal(initialState.issueCount, 3);
  assert.deepEqual(
    initialState.issues.map((issue) => issue.rule),
    ["Arcaísmo innecesario", "Voz pasiva", "Queismo y dequeismo"],
  );
  assert.match(initialState.issues[0].suggestion, /al final/i);
  assert.match(
    initialState.issues[1].suggestion,
    /La actora interpuso el recurso/i,
  );
  assert.match(initialState.issues[2].suggestion, /Posible queismo/i);
  assert.deepEqual(
    initialState.issues.map((issue) => issue.button),
    ["Aplicar cambio", "Ver en documento", "Ver en documento"],
  );
  assert.equal(initialState.readCalls, 1);

  await page.getByRole("button", { name: "↺" }).click();
  await page.waitForFunction(
    () => window.__docsReviewerTestState.readCalls === 2,
  );

  await page
    .locator(".docs-reviewer-issue-button", { hasText: "Ver en documento" })
    .first()
    .click();

  const finalState = await page.evaluate(() => ({
    activeIssueCount: document.querySelectorAll(".docs-reviewer-issue-active")
      .length,
    activeIssueButtonText: document
      .querySelector(".docs-reviewer-issue-active .docs-reviewer-issue-button")
      ?.textContent?.trim(),
  }));

  assert.equal(finalState.activeIssueCount, 1);
  assert.equal(finalState.activeIssueButtonText, "Ver en documento");

  await page.evaluate(() => {
    window.__docsReviewerTestState.failNextReadWithInvalidatedContext = true;
  });
  await page.getByRole("button", { name: "↺" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".docs-reviewer-placeholder.docs-reviewer-error")
      ?.textContent?.includes("La extensión se actualizó o recargó."),
  );

  const invalidatedState = await page.evaluate(() => ({
    errorMessage: document
      .querySelector(".docs-reviewer-placeholder.docs-reviewer-error")
      ?.textContent?.trim(),
    unhandledErrors: window.__docsReviewerTestState.unhandledErrors.slice(),
    unhandledRejections:
      window.__docsReviewerTestState.unhandledRejections.slice(),
  }));

  assert.match(
    invalidatedState.errorMessage,
    /La extensión se actualizó o recargó\./i,
  );
  assert.deepEqual(invalidatedState.unhandledErrors, []);
  assert.deepEqual(invalidatedState.unhandledRejections, []);
});
