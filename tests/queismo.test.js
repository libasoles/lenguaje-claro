const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const patterns = require(path.join(projectRoot, "rules", "patterns.json"));

function getPatternEntry(group, id) {
  const entry = patterns[group].find((item) => item.id === id);
  assert.ok(entry, `No se encontro el patron ${group}:${id}`);
  return entry;
}

function loadQueismoRule() {
  const source = fs.readFileSync(
    path.join(projectRoot, "rules", "queismo.js"),
    "utf8",
  );

  const sandbox = {
    console,
    window: {
      docsReviewerRules: [],
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "rules/queismo.js" });

  const rule = sandbox.window.docsReviewerRules.find((item) => item.id === "queismo");
  assert.ok(rule, "No se pudo cargar la regla de queismo");
  rule._patterns = patterns;
  rule.getPatterns = () => patterns;
  rule.getNlpEngine = () => null;
  rule._engineName = "fallback";
  return rule;
}

function assertRegexBehavior(entry, { matches = [], misses = [] }) {
  const regex = new RegExp(entry.triggerPattern, "gi");

  matches.forEach((sample) => {
    regex.lastIndex = 0;
    assert.equal(regex.test(sample), true, `Debia detectar: ${sample}`);
  });

  misses.forEach((sample) => {
    regex.lastIndex = 0;
    assert.equal(regex.test(sample), false, `No debia detectar: ${sample}`);
  });
}

test("todos los patrones curados compilan", () => {
  [
    ...patterns.requiere_de_que,
    ...patterns.nunca_de_que,
  ].forEach((entry) => {
    assert.doesNotThrow(() => new RegExp(entry.triggerPattern, "gi"), entry.id);
    assert.doesNotThrow(() => new RegExp(entry.suggestedPattern, "gi"), entry.id);
  });
});

test("matcher de darse cuenta cubre las frases reportadas", () => {
  const entry = getPatternEntry("requiere_de_que", "darse-cuenta");
  assertRegexBehavior(entry, {
    matches: [
      "Hay que darse cuenta que esto importa.",
      "Me da cuenta que no alcanza.",
    ],
    misses: [
      "Hay que darse cuenta de que esto importa.",
      "Hay que darse cuenta, si acaso, de lo ocurrido.",
    ],
  });
});

test("matcher de olvidarse detecta la forma sin de", () => {
  const entry = getPatternEntry("requiere_de_que", "olvidarse");
  assertRegexBehavior(entry, {
    matches: [
      "Es facil olvidarse que hay plazo.",
      "Se olvida que el termino vence hoy.",
    ],
    misses: [
      "Es facil olvidarse de que hay plazo.",
      "Se olvida de que el termino vence hoy.",
    ],
  });
});

test("matcher de dequeismo sigue detectando afirmar de que", () => {
  const entry = getPatternEntry("nunca_de_que", "afirmar");
  assertRegexBehavior(entry, {
    matches: ["La parte afirma de que hubo un error."],
    misses: ["La parte afirma que hubo un error."],
  });
});

test("la regla completa respeta exclusiones y devuelve hallazgos", () => {
  const rule = loadQueismoRule();
  const findings = rule.detectar(
    "Hay que darse cuenta que esto importa. La parte afirma de que hubo un error. Hay que darse cuenta que si no apelan, precluye.",
  );
  const hallazgoTipos = Array.from(findings, (item) => item.tipoHallazgo);

  assert.equal(findings.length, 2);
  assert.deepEqual(hallazgoTipos, ["queismo", "dequeismo"]);
  assert.equal(findings[0].textoOriginal, "darse cuenta que");
  assert.equal(findings[1].textoOriginal, "afirma de que");
});