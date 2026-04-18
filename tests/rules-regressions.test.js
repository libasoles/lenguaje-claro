const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

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
  const rule = loadRule("arcaismosRule", "./rules/arcaismos.js");
  const findings = rule.detectar(
    [
      "Tengo el agrado de dirigirme a usted.",
      "La documentación obra en mi poder.",
      "Quiero elevar una consulta formal.",
    ].join(" "),
  );

  assert.equal(findings.length, 3);
  assert.deepEqual(
    Array.from(findings, (item) => item.sugerencia),
    ["Le escribo para", "tengo", "consultar"],
  );
  assert.deepEqual(
    Array.from(findings, (item) => Array.from(item.sugerencias)),
    [["Le escribo para"], ["tengo"], ["consultar", "preguntar"]],
  );
});

test("vaguedades deja de detectar casos de alto ruido", () => {
  const rule = loadRule("vaguedadesRule", "./rules/vaguedades.js");
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
  const rule = loadRule("vaguedadesRule", "./rules/vaguedades.js");
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

test("voz pasiva reescribe la forma con paciente antes del auxiliar", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva.js");
  const findings = rule.detectar("La medida fue aprobada por el Senado.");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].textoOriginal, "La medida fue aprobada por el Senado");
  assert.equal(findings[0].sugerencia, "El Senado aprobó la medida");
});

test("voz pasiva reescribe la forma con auxiliar inicial", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva.js");
  const findings = rule.detectar("Fue interpuesto el recurso por la actora.");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].textoOriginal, "Fue interpuesto el recurso por la actora");
  assert.equal(findings[0].sugerencia, "La actora interpuso el recurso");
});

test("voz pasiva no detecta pasivas sin agente ni adjetivos con por", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva.js");

  assert.equal(rule.detectar("La nota fue publicada.").length, 0);
  assert.equal(rule.detectar("La ciudad fue bonita por años.").length, 0);
});

test("voz pasiva detecta participios acentuados con agente", () => {
  const rule = loadRule("vozPasivaRule", "./rules/voz-pasiva.js");
  const findings = rule.detectar("El texto fue leído por Juan.");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].sugerencia, "Juan leyó el texto");
});
