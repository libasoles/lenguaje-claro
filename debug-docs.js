const { chromium } = require("playwright");
const path = require("path");

async function debugGoogleDocs() {
  const extensionPath = path.resolve(__dirname);

  // Iniciar navegador con la extensión cargada
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("📖 Navegando a Google Docs...");
    // Usar un documento vacío de Google Docs
    await page.goto("https://docs.google.com/document/d/1", {
      waitUntil: "networkidle",
    });

    // Esperar a que el documento cargue
    await page.waitForTimeout(3000);

    console.log("\n🔍 Explorando estructura del DOM...\n");

    // Ejecutar diagnostico
    const diagnostico = await page.evaluate(() => {
      const results = {};

      // 1. Buscar app-view (contenedor principal)
      results.appView = document.querySelectorAll('[role="main"]').length;
      results.appViewKix = document.querySelectorAll(".kix-appview").length;
      results.appViewKixApp = document.querySelectorAll(
        ".kix-appview-edit-container",
      ).length;

      // 2. Selectores clásicos (viejos)
      results.klassicSelectors = {
        "kix-paragraphrenderer": document.querySelectorAll(
          ".kix-paragraphrenderer",
        ).length,
        "kix-page": document.querySelectorAll(".kix-page").length,
        "data-paragraph-id": document.querySelectorAll("[data-paragraph-id]")
          .length,
      };

      // 3. Buscar docos-stream-view
      const streamView = document.querySelector(
        '[role="list"].docos-stream-view',
      );
      results.streamViewFound = !!streamView;

      if (streamView) {
        results.streamViewText =
          streamView.innerText?.substring(0, 100) || "Sin texto";
        results.streamViewChildren = streamView.children.length;

        // Analizar los primeros hijos
        const firstChildren = Array.from(streamView.children).slice(0, 5);
        results.firstChildren = firstChildren.map((el) => ({
          tag: el.tagName,
          class: el.className,
          role: el.getAttribute("role"),
          dataId: el.getAttribute("data-id"),
          text: el.innerText?.substring(0, 50) || "",
        }));
      }

      // 4. Buscar todos los roles interesantes
      results.roleElements = {
        'role="textbox"': document.querySelectorAll('[role="textbox"]').length,
        'role="heading"': document.querySelectorAll('[role="heading"]').length,
        'role="list"': document.querySelectorAll('[role="list"]').length,
      };

      // 5. Buscar clases con "kix" o "doc"
      const allElements = document.querySelectorAll(
        '[class*="kix"], [class*="doc"]',
      );
      const classes = new Set();
      allElements.forEach((el) => {
        Array.from(el.classList).forEach((cls) => {
          if (cls.includes("kix") || cls.includes("doc")) classes.add(cls);
        });
      });
      results.foundClasses = Array.from(classes).slice(0, 20);

      // 6. Buscar el contenedor de edición
      const editContainer = document.querySelector(
        '[role="region"][aria-label*="ument"]',
      );
      results.editContainer = !!editContainer;
      if (editContainer) {
        results.editContainerClass = editContainer.className;
      }

      // 7. Búsqueda profunda por texto
      const treeWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false,
      );

      let textNodes = 0;
      let currentNode;
      while ((currentNode = treeWalker.nextNode())) {
        if (currentNode.textContent.trim().length > 0) {
          textNodes++;
        }
      }
      results.textNodesFound = textNodes;

      return results;
    });

    console.log("📊 Resultados del diagnóstico:");
    console.log("================================\n");
    console.log("1. Contenedores principales:");
    console.log(`   - [role="main"]: ${diagnostico.appView}`);
    console.log(`   - .kix-appview: ${diagnostico.appViewKix}`);
    console.log(
      `   - .kix-appview-edit-container: ${diagnostico.appViewKixApp}`,
    );

    console.log("\n2. Selectores clásicos (viejos):");
    Object.entries(diagnostico.klassicSelectors).forEach(([sel, count]) => {
      console.log(`   - .${sel}: ${count}`);
    });

    console.log("\n3. docos-stream-view:");
    console.log(`   - Encontrado: ${diagnostico.streamViewFound}`);
    if (diagnostico.streamViewFound) {
      console.log(`   - Texto: "${diagnostico.streamViewText}"`);
      console.log(`   - Hijos: ${diagnostico.streamViewChildren}`);
      if (diagnostico.firstChildren) {
        console.log("   - Primeros 5 hijos:");
        diagnostico.firstChildren.forEach((child, i) => {
          console.log(
            `     ${i}: <${child.tag}> clase="${child.class}" role="${child.role}" data-id="${child.dataId}"`,
          );
          console.log(`        Texto: "${child.text}"`);
        });
      }
    }

    console.log("\n4. Otros roles interesantes:");
    Object.entries(diagnostico.roleElements).forEach(([role, count]) => {
      console.log(`   - ${role}: ${count}`);
    });

    console.log("\n5. Clases encontradas (kix/doc):");
    diagnostico.foundClasses.forEach((cls) => console.log(`   - ${cls}`));

    console.log("\n6. Contenedor de edición:");
    console.log(`   - Encontrado: ${diagnostico.editContainer}`);
    if (diagnostico.editContainerClass) {
      console.log(`   - Clase: ${diagnostico.editContainerClass}`);
    }

    console.log(
      "\n7. Nodos de texto encontrados: " + diagnostico.textNodesFound,
    );

    // Ahora probar selectores más específicos
    console.log("\n\n🧪 Probando selectores específicos:");
    console.log("==================================\n");

    const selectorTests = await page.evaluate(() => {
      const tests = {};

      // Selectores a probar
      const selectorsToTest = [
        '[role="list"].docos-stream-view',
        '[role="list"].docos-stream-view > div',
        '[role="list"].docos-stream-view [role="listitem"]',
        '.docos-stream-view > [role="listitem"]',
        "[data-id]",
        "[data-content-id]",
        ".nKHsn", // Clase vista en algunos blogs
        '[aria-label*="ument"]',
        '[role="region"] [role="textbox"]',
        'div[role="document"]',
      ];

      selectorsToTest.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        let sampleText = "";
        if (elements.length > 0) {
          sampleText = elements[0].innerText?.substring(0, 50) || "";
        }
        tests[selector] = {
          count: elements.length,
          sampleText: sampleText,
        };
      });

      return tests;
    });

    Object.entries(selectorTests).forEach(([selector, data]) => {
      if (data.count > 0) {
        console.log(`✅ "${selector}"`);
        console.log(`   Encontrados: ${data.count}`);
        console.log(`   Ejemplo: "${data.sampleText}"`);
      }
    });

    // Intentar extraer el texto del documento como lo haría DocsReader
    console.log("\n\n📝 Intentando extraer texto del documento:");
    console.log("==========================================\n");

    const textExtraction = await page.evaluate(() => {
      const result = {
        methods: {},
      };

      // Método 1: Via docos-stream-view
      try {
        const streamView = document.querySelector(
          '[role="list"].docos-stream-view',
        );
        if (streamView) {
          const text = streamView.innerText;
          result.methods["docos-stream-view.innerText"] = {
            success: true,
            length: text.length,
            preview: text.substring(0, 100),
          };
        }
      } catch (e) {
        result.methods["docos-stream-view.innerText"] = {
          success: false,
          error: e.message,
        };
      }

      // Método 2: Via document.body
      try {
        const text = document.body.innerText;
        result.methods["document.body.innerText"] = {
          success: true,
          length: text.length,
          preview: text.substring(0, 100),
        };
      } catch (e) {
        result.methods["document.body.innerText"] = {
          success: false,
          error: e.message,
        };
      }

      // Método 3: Recolectar todos los nodos de texto
      try {
        const walker = document.createTreeWalker(
          document.querySelector('[role="list"].docos-stream-view') ||
            document.body,
          NodeFilter.SHOW_TEXT,
          null,
        );
        const texts = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent.trim();
          if (text && text.length > 0) {
            texts.push(text);
          }
        }
        const combined = texts.join("\n");
        result.methods["TreeWalker"] = {
          success: true,
          nodeCount: texts.length,
          length: combined.length,
          preview: combined.substring(0, 100),
        };
      } catch (e) {
        result.methods["TreeWalker"] = { success: false, error: e.message };
      }

      return result;
    });

    console.log("Métodos de extracción:");
    Object.entries(textExtraction.methods).forEach(([method, data]) => {
      if (data.success) {
        console.log(`✅ ${method}`);
        console.log(
          `   Longitud: ${data.length || data.nodeCount} caracteres/nodos`,
        );
        console.log(`   Preview: "${data.preview}"`);
      } else {
        console.log(`❌ ${method}`);
        console.log(`   Error: ${data.error}`);
      }
    });

    console.log(
      "\n\n✨ Debug completado. Lenguaje claro debería estar cargado en la página.",
    );
    console.log(
      "📋 Revisar la consola del navegador para logs de [Legal Docs]\n",
    );
  } catch (error) {
    console.error("Error durante debugging:", error);
  } finally {
    // Mantener el navegador abierto por 30 segundos para inspección
    console.log(
      "Navegador permanecerá abierto por 30 segundos para inspección...",
    );
    await page.waitForTimeout(30000);
    await browser.close();
  }
}

debugGoogleDocs().catch(console.error);
