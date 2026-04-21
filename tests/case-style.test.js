const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/load-browser-module.js");

const projectRoot = path.resolve(__dirname, "..");

const RULES = [
  { name: "arcaismosRule", file: "./rules/arcaismos/rule.js" },
  { name: "tecnicismosRule", file: "./rules/tecnicismos/rule.js" },
  { name: "vaguedadesRule", file: "./rules/vaguedades/rule.js" },
  { name: "rodeosRule", file: "./rules/rodeos/rule.js" },
  { name: "vozPasivaRule", file: "./rules/voz-pasiva/rule.js" },
  { name: "queismoRule", file: "./rules/queismo/rule.js" },
  { name: "nominalizacionRule", file: "./rules/nominalizacion/rule.js" },
  { name: "numerosRule", file: "./rules/numeros/rule.js" },
];

function capitalize(str) {
  return str.charAt(0).toLocaleUpperCase() + str.slice(1);
}

test("Las sugerencias respetan la mayúscula inicial si la frase original la tiene", async (t) => {
  for (const { name, file } of RULES) {
    const { exports } = loadBrowserModule({
      projectRoot,
      filename: `tests/${name}-entry.js`,
      source: `export { ${name} } from "${file}";`,
      sandbox: { console, window: {} },
    });
    const rule = exports[name];
    if (!rule || !rule.diccionario) continue;
    for (const entry of rule.diccionario) {
      if (!entry.original || !entry.sugerencias) continue;
      // Test solo la primera sugerencia para cada entrada
      const input = capitalize(entry.original);
      const findings = rule.detectar(input);
      if (!findings.length) continue;
      const sug = findings[0].sugerencias[0];
      if (!sug) continue;
      // Si la sugerencia es numérica, no debe capitalizar
      if (/^\d/.test(sug)) continue;
      assert.ok(
        /^[A-ZÁÉÍÓÚÑ]/.test(sug),
        `La sugerencia '${sug}' para '${input}' debería empezar con mayúscula en la regla ${name}`
      );
    }
  }
});
