import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const arcaismosRule = {
  id: "arcaismos",
  nombre: "Arcaísmo innecesario",
  descripcion: "Sustituye términos obsoletos por lenguaje actual",
  color: "#f1c40f", // Amarillo

  // Diccionario de arcaísmos
  diccionario: [
    { original: "in fine", sugerencia: "al final", palabrasClaves: "in fine" },
    {
      original: "a sensu contrario",
      sugerencia: "en sentido contrario",
      palabrasClaves: "a sensu contrario",
    },
    {
      original: "viene en decidir",
      sugerencia: "se decide",
      palabrasClaves: "viene en decidir",
    },
    {
      original: "otrosí digo",
      sugerencia: "además solicito",
      palabrasClaves: "otrosí digo",
    },
    {
      original: "susodicho",
      sugerencia: "mencionado",
      palabrasClaves: "susodicho",
    },
    {
      original: "infraescrito",
      sugerencia: "quien firma",
      palabrasClaves: "infraescrito",
    },
    {
      original: "fehaciente",
      sugerencia: "comprobable",
      palabrasClaves: "fehaciente",
    },
    { original: "incoar", sugerencia: "iniciar", palabrasClaves: "incoar" },
    { original: "adverar", sugerencia: "acreditar", palabrasClaves: "adverar" },
    { original: "dirimir", sugerencia: "resolver", palabrasClaves: "dirimir" },
    {
      original: "decaer en su derecho",
      sugerencia: "perder su derecho",
      palabrasClaves: "decaer en su derecho",
    },
    {
      original: "sírvase proveer",
      sugerencia: "disponga",
      palabrasClaves: "sírvase proveer",
    },
    {
      original: "tenor literal",
      sugerencia: "texto literal",
      palabrasClaves: "tenor literal",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      // Case-insensitive regex con word boundaries
      const pattern = buildAccentInsensitivePattern(item.palabrasClaves);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        const sugerencia = mantenerCase(match[0], item.sugerencia);
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por "${sugerencia}"`,
        });
      }
    });

    return matches;
  },
};

export default arcaismosRule;
