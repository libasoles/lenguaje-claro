const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("../../tests/helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..", "..");

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

test("tecnicismos mapea determinantes: 'la mora' -> 'el retraso'", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("la mora");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sugerencias[0], "el retraso");
});

test("tecnicismos sin determinante: 'mora' -> 'retraso'", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("mora");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sugerencias[0], "retraso");
});

test("tecnicismos respeta mayúsculas en determinante: 'La mora' -> 'El retraso'", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("La mora");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sugerencias[0], "El retraso");
});

test("tecnicismos ajusta el artículo al núcleo inicial de la sugerencia", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("el prestatario");

  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].sugerencias[0],
    "la persona que recibe un préstamo",
  );
});

test("tecnicismos ajusta artículos plurales para cada sugerencia", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("las estipulaciones");

  assert.equal(findings.length, 1);
  assert.deepEqual(Array.from(findings[0].sugerencias), [
    "las condiciones",
    "los términos",
  ]);
});

test("tecnicismos ajusta demostrativos simples", () => {
  const rule = loadRule("tecnicismosRule", "./rules/tecnicismos/rule.js");
  const findings = rule.detectar("esta mora");

  assert.equal(findings.length, 1);
  assert.deepEqual(Array.from(findings[0].sugerencias), [
    "este retraso",
    "este aplazamiento",
  ]);
});
