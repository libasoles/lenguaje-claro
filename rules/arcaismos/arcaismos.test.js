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

test("arcaismos devuelve sugerencias válidas para entradas normalizadas", () => {
  const rule = loadRule("arcaismosRule", "./rules/arcaismos/rule.js");
  const findings = rule.detectar(
    [
      "Tengo el agrado de dirigirme a usted.",
      "La documentación obra en mi poder.",
      "Quiero elevar una consulta formal.",
    ].join(" "),
  );
  assert.equal(findings.length, 3);
  assert.deepEqual(
    Array.from(findings, (item) => item.sugerencias[0]),
    ["Le escribo para", "tengo", "consultar"],
  );
  assert.deepEqual(
    Array.from(findings, (item) => Array.from(item.sugerencias)),
    [["Le escribo para"], ["tengo"], ["consultar", "preguntar"]],
  );
});
