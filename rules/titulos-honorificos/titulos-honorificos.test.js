const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  loadBrowserModule,
} = require("../../tests/helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "../..");

function loadRule(exportName, rulePath) {
  const { exports } = loadBrowserModule({
    projectRoot,
    filename: `tests/${exportName}-entry.js`,
    source: `export { ${exportName} } from "${rulePath}";`,
    sandbox: { console },
  });

  const rule = exports[exportName];
  assert.ok(rule, `No se pudo cargar la regla ${exportName}`);
  return rule;
}

test("titulos honorificos reemplaza tratamientos cerrados por el cargo u órgano", () => {
  const rule = loadRule(
    "titulosHonorificosRule",
    "./rules/titulos-honorificos/rule.js",
  );
  const findings = rule.detectar("La Excma. Cámara escuchó al señor juez.");

  assert.deepEqual(
    Array.from(findings, (item) => item.textoOriginal),
    ["Excma. Cámara", "señor juez"],
  );
  assert.deepEqual(
    Array.from(findings, (item) => item.sugerencias[0]),
    ["Cámara", "juez"],
  );
  assert.ok(findings.every((item) => item.aplicable !== false));
});

test("titulos honorificos advierte cuando no hay reemplazo seguro", () => {
  const rule = loadRule(
    "titulosHonorificosRule",
    "./rules/titulos-honorificos/rule.js",
  );
  const findings = rule.detectar(
    "Solicito a V.S. y a Su Señoría que omitan ese trato distinguido.",
  );

  assert.deepEqual(
    Array.from(findings, (item) => item.textoOriginal),
    ["V.S.", "Su Señoría", "distinguido"],
  );
  assert.ok(findings.every((item) => item.aplicable === false));
  assert.ok(
    findings.every((item) =>
      /evit[aá]|tratamiento/i.test(item.sugerencias[0]),
    ),
  );
});

test("titulos honorificos no detecta palabras solo parcialmente relacionadas", () => {
  const rule = loadRule(
    "titulosHonorificosRule",
    "./rules/titulos-honorificos/rule.js",
  );
  const findings = rule.detectar(
    "El honorario, la distinción académica y el trato honorablemente dado no son fórmulas de tratamiento.",
  );

  assert.equal(findings.length, 0);
});

test("titulos honorificos está registrada en el índice de reglas", () => {
  const { exports } = loadBrowserModule({
    projectRoot,
    filename: "tests/titulos-honorificos-index-entry.js",
    source: 'export { rules } from "./rules/index.js";',
    sandbox: { console, window: {} },
  });

  assert.ok(
    exports.rules.some((rule) => rule.id === "titulos-honorificos"),
  );
});
