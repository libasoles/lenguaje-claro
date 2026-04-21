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

test("voz pasiva reescribe la forma con paciente antes del auxiliar", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva/rule.js");
  const findings = rule.detectar("La medida fue aprobada por el Senado.");

  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].textoOriginal,
    "La medida fue aprobada por el Senado",
  );
  assert.equal(findings[0].sugerencias[0], "El Senado aprobó la medida");
});

test("voz pasiva reescribe la forma con auxiliar inicial", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva/rule.js");
  const findings = rule.detectar("Fue interpuesto el recurso por la actora.");

  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].textoOriginal,
    "Fue interpuesto el recurso por la actora",
  );
  assert.equal(findings[0].sugerencias[0], "La actora interpuso el recurso");
});

test("voz pasiva no detecta pasivas sin agente ni adjetivos con por", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva/rule.js");

  assert.equal(rule.detectar("La nota fue publicada.").length, 0);
  assert.equal(rule.detectar("La ciudad fue bonita por años.").length, 0);
});

test("voz pasiva detecta participios acentuados con agente", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva/rule.js");
  const findings = rule.detectar("El texto fue leído por Juan.");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sugerencias[0], "Juan leyó el texto");
});
