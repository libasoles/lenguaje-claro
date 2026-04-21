const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  loadBrowserModule,
} = require("../../tests/helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "../..");

function loadRule() {
  const { exports } = loadBrowserModule({
    projectRoot,
    filename: "tests/siglasRule-entry.js",
    source: `export { default as siglasRule } from "./rules/siglas/rule.js";`,
    sandbox: { console },
  });

  assert.ok(exports.siglasRule, "No se pudo cargar la regla de siglas");
  return exports.siglasRule;
}

test("Regla de siglas sin puntos", async (t) => {
  await t.test("detecta siglas con puntos y sugiere la forma correcta", () => {
    const siglasRule = loadRule();
    const texto = "La U.N.E.S.C.O. y la O.N.U. son organizaciones internacionales.";
    const hallazgos = siglasRule.detectar(texto);
    assert.strictEqual(hallazgos.length, 2);
    assert.strictEqual(hallazgos[0].textoOriginal, "U.N.E.S.C.O");
    assert.strictEqual(hallazgos[0].sugerencias[0], "UNESCO");
    assert.strictEqual(hallazgos[1].textoOriginal, "O.N.U");
    assert.strictEqual(hallazgos[1].sugerencias[0], "ONU");
  });

  await t.test("no marca siglas ya correctas", () => {
    const siglasRule = loadRule();
    const texto = "UNESCO y ONU trabajan juntas.";
    const hallazgos = siglasRule.detectar(texto);
    assert.strictEqual(hallazgos.length, 0);
  });
});
