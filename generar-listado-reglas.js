// Script para generar un listado exhaustivo de reglas y ejemplos en HTML.
// Ejecuta: node generar-listado-reglas.js

const fs = require("fs");
const path = require("path");

const RULES_DIR = path.join(__dirname, "rules");
const OUTPUT_HTML = path.join(__dirname, "rules-list.html");
const GITIGNORE = path.join(__dirname, ".gitignore");

function getRuleDirs() {
  const indexPath = path.join(RULES_DIR, "index.ts");

  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, "utf8");
    const dirs = Array.from(
      indexContent.matchAll(/from\s+["']\.\/([^/"']+)\/rule\.js["']/g),
      (match) => match[1],
    ).filter((dir) => fs.existsSync(path.join(RULES_DIR, dir, "rule.ts")));

    if (dirs.length > 0) return dirs;
  }

  return fs
    .readdirSync(RULES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(RULES_DIR, entry.name, "rule.ts")),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "es"));
}

function unescapeStringLiteral(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\(["'`\\])/g, "$1");
}

function extractStringProperty(content, propertyName) {
  const regex = new RegExp(
    `\\b${propertyName}\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`,
  );
  const match = content.match(regex);

  if (!match) return "";

  return unescapeStringLiteral(match[2]).replace(/\s+/g, " ").trim();
}

function readRuleMeta(ruleDir) {
  const rulePath = path.join(RULES_DIR, ruleDir, "rule.ts");
  const content = fs.readFileSync(rulePath, "utf8");

  return {
    nombre: extractStringProperty(content, "nombre") || ruleDir,
    descripcion: extractStringProperty(content, "descripcion"),
    color: extractStringProperty(content, "color") || "#ccc",
  };
}

function asList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null && item !== "").map(String);
  }

  if (value == null || value === "") return [];

  return [String(value)];
}

function patternToExample(pattern) {
  if (typeof pattern === "string") {
    return { texto: pattern, sugerencia: [] };
  }

  if (!pattern || typeof pattern !== "object") return null;

  const texto =
    pattern.original || pattern.texto || pattern.label || pattern.id;
  if (!texto) return null;

  return {
    texto: String(texto),
    sugerencia: asList(
      pattern.sugerencias ||
        pattern.sugerencia ||
        pattern.precision ||
        pattern.alternativas ||
        pattern.advertencia,
    ),
  };
}

function readQueismoExamples(patterns) {
  const ejemplos = [];

  if (Array.isArray(patterns.requiere_de_que)) {
    patterns.requiere_de_que.forEach((pattern) => {
      const label = pattern.label || pattern.id;
      if (!label) return;
      ejemplos.push({
        texto: `${label} que`,
        sugerencia: [`${label} de que`],
      });
    });
  }

  if (Array.isArray(patterns.nunca_de_que)) {
    patterns.nunca_de_que.forEach((pattern) => {
      const label = pattern.label || pattern.id;
      if (!label) return;
      ejemplos.push({
        texto: `${label} de que`,
        sugerencia: [`${label} que`],
      });
    });
  }

  return ejemplos;
}

function readPatterns(ruleDir) {
  const patternsPath = path.join(RULES_DIR, ruleDir, "patterns.json");
  if (!fs.existsSync(patternsPath)) return [];

  try {
    const patterns = JSON.parse(fs.readFileSync(patternsPath, "utf8"));

    if (ruleDir === "queismo") {
      return readQueismoExamples(patterns);
    }

    if (Array.isArray(patterns)) {
      return patterns.map(patternToExample).filter(Boolean);
    }

    if (patterns && typeof patterns === "object") {
      return Object.entries(patterns)
        .map(([texto, sugerencia]) => ({
          texto,
          sugerencia: asList(sugerencia),
        }))
        .filter((example) => example.texto);
    }
  } catch (error) {
    console.warn(
      `No se pudo leer ${path.relative(__dirname, patternsPath)}: ${error.message}`,
    );
  }

  return [];
}

function readTestExamples(ruleDir) {
  const rulePath = path.join(RULES_DIR, ruleDir);
  const testFiles = fs
    .readdirSync(rulePath)
    .filter((file) => file.endsWith(".test.js"))
    .sort();

  if (testFiles.length === 0) return [];

  const ejemplos = [];
  const assertionPairRegex =
    /assert\.(?:strictEqual|equal)\(\s*[\s\S]*?\.textoOriginal\s*,\s*(["'`])([\s\S]*?)\1\s*,?\s*\)\s*;[\s\S]{0,700}?assert\.(?:strictEqual|equal)\(\s*[\s\S]*?\.sugerencias\[0\]\s*,\s*(["'`])([\s\S]*?)\3\s*,?\s*\)\s*;/g;

  testFiles.forEach((file) => {
    const content = fs.readFileSync(path.join(rulePath, file), "utf8");
    let match;

    while ((match = assertionPairRegex.exec(content)) !== null) {
      ejemplos.push({
        texto: unescapeStringLiteral(match[2]),
        sugerencia: [unescapeStringLiteral(match[4])],
      });
    }
  });

  return ejemplos;
}

function getManualExamples(ruleDir) {
  const examplesByRule = {
    numeros: [
      {
        texto: "treinta y dos",
        sugerencia: ["32", "treinta y dos (32)"],
      },
      {
        texto: "ciento veinte",
        sugerencia: ["120", "ciento veinte (120)"],
      },
      {
        texto: "dos millones",
        sugerencia: ["2000000", "dos millones (2000000)"],
      },
      { texto: "IV", sugerencia: ["4"] },
      { texto: "XXI", sugerencia: ["21"] },
    ],
    siglas: [
      { texto: "U.N.E.S.C.O", sugerencia: ["UNESCO"] },
      { texto: "O.N.U", sugerencia: ["ONU"] },
    ],
    "voz-pasiva": [
      {
        texto: "La medida fue aprobada por el Senado",
        sugerencia: ["El Senado aprobó la medida"],
      },
      {
        texto: "Fue interpuesto el recurso por la actora",
        sugerencia: ["La actora interpuso el recurso"],
      },
    ],
  };

  return examplesByRule[ruleDir] || [];
}

function getExamples(ruleDir) {
  const patterns = readPatterns(ruleDir);
  if (patterns.length > 0) return patterns;

  const testExamples = readTestExamples(ruleDir);
  if (testExamples.length > 0) return testExamples;

  return getManualExamples(ruleDir);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderExampleRows(ejemplo) {
  const suggestions = asList(ejemplo.sugerencia);

  if (suggestions.length === 0) {
    return `<tr><td>${escapeHtml(ejemplo.texto)}</td><td></td></tr>`;
  }

  if (suggestions.length === 1) {
    return `<tr><td>${escapeHtml(ejemplo.texto)}</td><td>${escapeHtml(
      suggestions[0],
    )}</td></tr>`;
  }

  const firstRow = `<tr><td rowspan="${suggestions.length}">${escapeHtml(
    ejemplo.texto,
  )}</td><td>${escapeHtml(suggestions[0])}</td></tr>`;
  const extraRows = suggestions
    .slice(1)
    .map(
      (suggestion) =>
        `<tr class="sugerencia-subfila"><td>${escapeHtml(suggestion)}</td></tr>`,
    )
    .join("");

  return firstRow + extraRows;
}

function buildHTML(rulesData) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Listado de reglas y ejemplos - Lenguaje Claro</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f8; color: #222; margin: 0; padding: 2rem; }
    h1 { margin: 0 0 2rem; text-align: center; }
    .regla { background: #fff; border-left: 12px solid; border-radius: 8px; box-shadow: 0 2px 8px #0001; margin: 0 0 2rem; padding: 1.5rem; }
    .regla h2 { margin: 0 0 0.5rem; }
    .regla p { margin: 0; color: #555; }
    .tabla-contenedor { margin-top: 1rem; max-width: 100%; overflow-x: auto; }
    table { border-collapse: collapse; display: inline-table; width: auto; }
    th, td { border: 1px solid #e7e7eb; padding: 0.45rem 0.65rem; text-align: left; vertical-align: top; white-space: nowrap; }
    th { background: #f0f0f2; }
    td:first-child { font-weight: 600; }
    .sugerencia-subfila td { border-top: 2px solid #c7c9d1; }
    .sin-ejemplo { color: #888; font-style: italic; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Listado de reglas y ejemplos</h1>
  ${rulesData
    .map(
      (regla) => `
    <section class="regla" style="border-color: ${escapeHtml(regla.color)}">
      <h2>${escapeHtml(regla.nombre)}</h2>
      <p>${escapeHtml(regla.descripcion)}</p>
      ${
        regla.ejemplos.length > 0
          ? `
        <div class="tabla-contenedor">
          <table>
            <thead>
              <tr><th>Texto detectado</th><th>Sugerencia</th></tr>
            </thead>
            <tbody>
              ${regla.ejemplos.map(renderExampleRows).join("")}
            </tbody>
          </table>
        </div>
      `
          : `<div class="sin-ejemplo">No hay ejemplos disponibles.</div>`
      }
    </section>
  `,
    )
    .join("")}
</body>
</html>
`;
}

function ensureGitignoreHasOutput() {
  if (!fs.existsSync(GITIGNORE)) return;

  const gitignore = fs.readFileSync(GITIGNORE, "utf8");
  const entries = gitignore.split(/\r?\n/).map((line) => line.trim());

  if (entries.includes("rules-list.html")) return;

  const separator =
    gitignore.endsWith("\n") || gitignore.length === 0 ? "" : "\n";
  fs.writeFileSync(
    GITIGNORE,
    `${gitignore}${separator}rules-list.html\n`,
    "utf8",
  );
}

function main() {
  const rulesData = getRuleDirs().map((ruleDir) => ({
    ...readRuleMeta(ruleDir),
    ejemplos: getExamples(ruleDir),
  }));

  const html = buildHTML(rulesData);
  fs.writeFileSync(OUTPUT_HTML, html, "utf8");
  ensureGitignoreHasOutput();

  console.log(`Archivo generado: ${path.relative(__dirname, OUTPUT_HTML)}`);
}

if (require.main === module) main();
