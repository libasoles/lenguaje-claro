import { buildAccentInsensitivePattern } from "./shared.js";

export const vaguedadesRule = {
  id: "vaguedades",
  nombre: "Vaguedad",
  descripcion:
    "Reemplaza expresiones vagas por información precisa y verificable",
  color: "#8e44ad", // Violeta

  // `precision` explica qué tipo de información concreta reemplazaría la vaguedad.
  // No se puede sugerir un texto exacto, por eso `aplicable: false`.

  // TODO: da falsos positivos, como "responsabilidad alguna", "algún modo", "alguna manera", "alguna vez", "pronto llegará el verano",
  diccionario: [
    {
      palabrasClaves: "mucho",
      precision: "Cifra o porcentaje (ej: 90%)",
    },
    {
      palabrasClaves: "mucha",
      precision: "Cifra o porcentaje (ej: 90%)",
    },
    {
      palabrasClaves: "muchos",
      precision: "Cifra o porcentaje (ej: 90%)",
    },
    {
      palabrasClaves: "muchas",
      precision: "Cifra o porcentaje (ej: 90%)",
    },
    {
      palabrasClaves: "maravilloso",
      precision: "Cifra o porcentaje de satisfacción (ej: 85%)",
    },
    {
      palabrasClaves: "maravillosa",
      precision: "Cifra o porcentaje de satisfacción (ej: 85%)",
    },
    {
      palabrasClaves: "en alguna medida",
      precision: "Cifra de proporción numérica (ej: uno de cada tres)",
    },
    {
      palabrasClaves: "razonable",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "suficiente",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "suficientes",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "considerable",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "considerables",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "oportuno",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "oportuna",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.palabrasClaves);
      const regex =
        item.palabrasClaves === "muchas"
          ? new RegExp(`\\b${pattern}\\b(?!\\s+gracias\\b)`, "gi")
          : new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia: item.precision,
          aplicable: false,
          regla: this.id,
          descripcion: `"${match[0]}" es una expresión vaga`,
        });
      }
    });

    return matches;
  },
};

export default vaguedadesRule;
