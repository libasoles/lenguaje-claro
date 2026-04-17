import { buildAccentInsensitivePattern } from "./shared.js";

export const vaguedadesRule = {
  id: "vaguedades",
  nombre: "Vaguedad",
  descripcion:
    "Reemplaza expresiones vagas por información precisa y verificable",
  color: "#8e44ad", // Violeta

  // `precision` explica qué tipo de información concreta reemplazaría la vaguedad.
  // No se puede sugerir un texto exacto, por eso `aplicable: false`.
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
      palabrasClaves: "algunos",
      precision: "Cifra o porcentaje de cantidad (ej: cuatro de diez)",
    },
    {
      palabrasClaves: "algunas",
      precision: "Cifra o porcentaje de cantidad (ej: cuatro de diez)",
    },
    {
      palabrasClaves: "algún",
      precision: "Cifra o porcentaje de cantidad (ej: cuatro de diez)",
    },
    {
      palabrasClaves: "alguna",
      precision: "Cifra o porcentaje de cantidad (ej: cuatro de diez)",
    },
    {
      palabrasClaves: "pronto",
      precision: "Periodo de tiempo (ej: en dos días; el 18 de julio)",
    },
    {
      palabrasClaves: "en alguna medida",
      precision: "Cifra de proporción numérica (ej: uno de cada tres)",
    },
    {
      palabrasClaves: "apropiado",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
    {
      palabrasClaves: "apropiada",
      precision:
        "Cifra que sustente la afirmación (ej: un computador por cada tres estudiantes)",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.palabrasClaves);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
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
