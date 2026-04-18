// Converts a Roman numeral string to its Arabic numeral string equivalent
function romanToArabic(roman) {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  const r = roman.toUpperCase();
  for (let i = 0; i < r.length; i++) {
    const curr = values[r[i]];
    const next = values[r[i + 1]];
    if (next && curr < next) result -= curr;
    else result += curr;
  }
  return String(result);
}

const ROMAN_CANDIDATE_REGEX = /\b[MDCLXVI]+\b/g;
const ROMAN_VALID_REGEX =
  /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

// Words that commonly precede a Roman numeral in Spanish official documents
const ROMAN_CONTEXT_WORDS =
  /(?:art[ií]culo|cap[ií]tulo|t[ií]tulo|secci[oó]n|parte|libro|tomo|apartado|anexo|inciso|numeral|disposici[oó]n|punto|fase|etapa|siglo)\s+$/i;

const WORD_REGEX = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
const AMBIGUOUS_SINGULAR_TOKENS = new Set(["un", "uno", "una"]);

const UNIT_VALUES = new Map([
  ["cero", 0],
  ["un", 1],
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
]);

function withVentiAliases(entries) {
  const result = [];

  for (const [word, value] of entries) {
    result.push([word, value]);

    if (word.startsWith("veinti")) {
      result.push([`venti${word.slice("veinti".length)}`, value]);
    }
  }

  return result;
}

const SPECIAL_VALUES = new Map(
  withVentiAliases([
    ["diez", 10],
    ["once", 11],
    ["doce", 12],
    ["trece", 13],
    ["catorce", 14],
    ["quince", 15],
    ["dieciseis", 16],
    ["diecisiete", 17],
    ["dieciocho", 18],
    ["diecinueve", 19],
    ["veintiuno", 21],
    ["veintiun", 21],
    ["veintiuna", 21],
    ["veintidos", 22],
    ["veintitres", 23],
    ["veinticuatro", 24],
    ["veinticinco", 25],
    ["veintiseis", 26],
    ["veintisiete", 27],
    ["veintiocho", 28],
    ["veintinueve", 29],
  ]),
);

const TENS_VALUES = new Map([
  ["veinte", 20],
  ["treinta", 30],
  ["cuarenta", 40],
  ["cincuenta", 50],
  ["sesenta", 60],
  ["setenta", 70],
  ["ochenta", 80],
  ["noventa", 90],
]);

const HUNDREDS_VALUES = new Map([
  ["cien", 100],
  ["ciento", 100],
  ["doscientos", 200],
  ["doscientas", 200],
  ["trescientos", 300],
  ["trescientas", 300],
  ["cuatrocientos", 400],
  ["cuatrocientas", 400],
  ["quinientos", 500],
  ["quinientas", 500],
  ["seiscientos", 600],
  ["seiscientas", 600],
  ["setecientos", 700],
  ["setecientas", 700],
  ["ochocientos", 800],
  ["ochocientas", 800],
  ["novecientos", 900],
  ["novecientas", 900],
]);

function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function tokenizeWords(texto) {
  const tokens = [];
  let match;

  while ((match = WORD_REGEX.exec(texto)) !== null) {
    tokens.push({
      original: match[0],
      normalized: normalizeWord(match[0]),
      inicio: match.index,
      fin: match.index + match[0].length,
    });
  }

  return tokens;
}

function parseBasicNumber(tokens, startIndex) {
  if (startIndex >= tokens.length) return null;

  let index = startIndex;
  let value = 0;

  const hundredToken = tokens[index].normalized;
  if (HUNDREDS_VALUES.has(hundredToken)) {
    value += HUNDREDS_VALUES.get(hundredToken);
    index += 1;
  }

  if (index >= tokens.length) {
    return index > startIndex ? { value, consumed: index - startIndex } : null;
  }

  const currentToken = tokens[index].normalized;

  if (SPECIAL_VALUES.has(currentToken)) {
    value += SPECIAL_VALUES.get(currentToken);
    index += 1;
    return { value, consumed: index - startIndex };
  }

  if (TENS_VALUES.has(currentToken)) {
    value += TENS_VALUES.get(currentToken);
    index += 1;

    if (
      value >= 30 &&
      tokens[index]?.normalized === "y" &&
      UNIT_VALUES.has(tokens[index + 1]?.normalized) &&
      UNIT_VALUES.get(tokens[index + 1].normalized) > 0
    ) {
      value += UNIT_VALUES.get(tokens[index + 1].normalized);
      index += 2;
    }

    return { value, consumed: index - startIndex };
  }

  if (UNIT_VALUES.has(currentToken)) {
    value += UNIT_VALUES.get(currentToken);
    index += 1;
    return { value, consumed: index - startIndex };
  }

  return index > startIndex ? { value, consumed: index - startIndex } : null;
}

function parseWrittenNumber(tokens, startIndex) {
  let index = startIndex;
  let total = 0n;
  let consumedAny = false;

  while (index < tokens.length) {
    const token = tokens[index].normalized;

    if (token === "y") break;

    if (token === "mil") {
      total += 1000n;
      index += 1;
      consumedAny = true;
      continue;
    }

    if (token === "millon") {
      total += 1000000n;
      index += 1;
      consumedAny = true;
      continue;
    }

    const group = parseBasicNumber(tokens, index);
    if (!group) break;

    consumedAny = true;
    index += group.consumed;

    const magnitudeToken = tokens[index]?.normalized;
    if (magnitudeToken === "mil") {
      total += BigInt(group.value) * 1000n;
      index += 1;
      continue;
    }

    if (magnitudeToken === "millon" || magnitudeToken === "millones") {
      total += BigInt(group.value) * 1000000n;
      index += 1;
      continue;
    }

    total += BigInt(group.value);
    break;
  }

  const consumed = index - startIndex;
  if (!consumedAny || consumed === 0) return null;

  if (
    consumed === 1 &&
    AMBIGUOUS_SINGULAR_TOKENS.has(tokens[startIndex].normalized)
  ) {
    return null;
  }

  return {
    valor: total.toString(),
    consumed,
    ultimoIndice: index - 1,
  };
}

export const numerosRule = {
  id: "numeros",
  nombre: "Números",
  descripcion:
    "Sugiere reemplazar números escritos con palabras por dígitos, y números romanos por arábigos",
  color: "#2980b9", // Azul

  detectar(texto) {
    if (typeof texto !== "string" || texto.length === 0) return [];

    const matches = [];
    const wordTokens = tokenizeWords(texto);

    // Consume full Spanish number phrases from left to right.
    for (let i = 0; i < wordTokens.length; ) {
      const parsed = parseWrittenNumber(wordTokens, i);
      if (!parsed) {
        i += 1;
        continue;
      }

      const firstToken = wordTokens[i];
      const lastToken = wordTokens[parsed.ultimoIndice];
      const textoOriginal = texto.slice(firstToken.inicio, lastToken.fin);

      matches.push({
        inicio: firstToken.inicio,
        fin: lastToken.fin,
        textoOriginal,
        sugerencia: parsed.valor,
        sugerencias: [parsed.valor],
        regla: this.id,
        descripcion: `Usar dígito en lugar de la expresión: "${textoOriginal}" → ${parsed.valor}`,
      });

      i += parsed.consumed;
    }

    // Roman numerals are scanned separately to keep validation strict and avoid
    // global-regex empty matches that can stall detection.
    ROMAN_CANDIDATE_REGEX.lastIndex = 0;
    let romanMatch;
    while ((romanMatch = ROMAN_CANDIDATE_REGEX.exec(texto)) !== null) {
      const matched = romanMatch[0];
      if (!ROMAN_VALID_REGEX.test(matched)) continue;

      if (matched.length === 1) {
        const before = texto.slice(0, romanMatch.index);
        if (!ROMAN_CONTEXT_WORDS.test(before)) continue;
      }

      const arabic = romanToArabic(matched);
      if (arabic === "0") continue;

      const alreadyCovered = matches.some(
        (m) => m.inicio < romanMatch.index + matched.length && m.fin > romanMatch.index,
      );
      if (alreadyCovered) continue;

      matches.push({
        inicio: romanMatch.index,
        fin: romanMatch.index + matched.length,
        textoOriginal: matched,
        sugerencia: arabic,
        sugerencias: [arabic],
        regla: this.id,
        descripcion: `Reemplazar número romano "${matched}" por "${arabic}"`,
      });
    }

    return matches
      .sort((a, b) => a.inicio - b.inicio)
      .map((match, index) => ({
        ...match,
        id: `${this.id}-${index}`,
      }));
  },
};

export default numerosRule;
