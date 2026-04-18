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

test("numeros detecta cardinales compuestos y magnitudes completas", () => {
  const rule = loadRule("numerosRule", "./rules/numeros.js");
  const findings = rule.detectar(
    [
      "Tiene treinta y dos copias.",
      "Tiene ciento veinte páginas.",
      "Tiene mil doscientos pesos.",
      "Tiene dos millones de pesos.",
    ].join(" "),
  );

  assert.deepEqual(
    Array.from(findings, (item) => [item.textoOriginal.toLocaleLowerCase(), item.sugerencia]),
    [
      ["treinta y dos", "32"],
      ["ciento veinte", "120"],
      ["mil doscientos", "1200"],
      ["dos millones", "2000000"],
    ],
  );
});

test("numeros soporta variantes frecuentes con y sin tilde", () => {
  const rule = loadRule("numerosRule", "./rules/numeros.js");
  const findings = rule.detectar(
    [
      "Hubo veintiún días de espera.",
      "Se revisaron doscientas actas.",
      "Faltan dieciseis firmas.",
    ].join(" "),
  );

  assert.deepEqual(
    Array.from(findings, (item) => [item.textoOriginal, item.sugerencia]),
    [
      ["veintiún", "21"],
      ["doscientas", "200"],
      ["dieciseis", "16"],
    ],
  );
});

test("numeros acepta variantes venti equivalentes a veinti", () => {
  const rule = loadRule("numerosRule", "./rules/numeros.js");
  const findings = rule.detectar(
    [
      "Hubo ventiuno casos.",
      "Se contaron ventidos testigos.",
      "Llegaron ventiséis escritos.",
      "Quedan ventinueve días.",
    ].join(" "),
  );

  assert.deepEqual(
    Array.from(findings, (item) => [item.textoOriginal, item.sugerencia]),
    [
      ["ventiuno", "21"],
      ["ventidos", "22"],
      ["ventiséis", "26"],
      ["ventinueve", "29"],
    ],
  );
});

test("numeros evita artículos singulares ambiguos", () => {
  const rule = loadRule("numerosRule", "./rules/numeros.js");
  const findings = rule.detectar("Tiene una copia y un anexo.");

  assert.equal(findings.length, 0);
});

test("numeros convierte romanos sin colgar la detección", () => {
  const rule = loadRule("numerosRule", "./rules/numeros.js");
  const findings = rule.detectar("Capítulo IV. Siglo XXI.");

  assert.deepEqual(
    Array.from(findings, (item) => [item.textoOriginal, item.sugerencia]),
    [
      ["IV", "4"],
      ["XXI", "21"],
    ],
  );
});
