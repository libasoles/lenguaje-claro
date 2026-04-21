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

test("vaguedades deja de detectar casos de alto ruido", () => {
  const rule = loadRule("vaguedadesRule", "./rules/vaguedades/rule.js");
  const findings = rule.detectar(
    [
      "Alguna vez lo revisaremos.",
      "No existe responsabilidad alguna.",
      "Pronto llegará el verano.",
      "Muchas gracias por venir.",
    ].join(" "),
  );

  assert.equal(findings.length, 0);
});

test("vaguedades conserva frases inequívocas y nuevas entradas de bajo ruido", () => {
  const rule = loadRule("vaguedadesRule", "./rules/vaguedades/rule.js");
  const findings = rule.detectar(
    [
      "La solución es razonable.",
      "Hay fundamentos suficientes.",
      "La mejora opera en alguna medida.",
    ].join(" "),
  );

  assert.deepEqual(
    Array.from(findings, (item) => item.textoOriginal.toLocaleLowerCase()),
    ["en alguna medida", "razonable", "suficientes"],
  );
  assert.ok(findings.every((item) => item.aplicable === false));
});
