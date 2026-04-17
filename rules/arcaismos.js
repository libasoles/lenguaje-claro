import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const arcaismosRule = {
  id: "arcaismos",
  nombre: "Arcaísmo innecesario",
  descripcion: "Sustituye términos obsoletos por lenguaje actual",
  color: "#f1c40f", // Amarillo

  // Diccionario de arcaísmos
  diccionario: [
    { original: "in fine", sugerencia: "al final" },
    {
      original: "a sensu contrario",
      sugerencia: "en sentido contrario",
    },
    {
      original: "viene en decidir",
      sugerencia: "se decide",
    },
    {
      original: "otrosí digo",
      sugerencia: "además solicito",
    },
    {
      original: "susodicho",
      sugerencia: "mencionado",
    },
    {
      original: "infraescrito",
      sugerencia: "quien firma",
    },
    {
      original: "fehaciente",
      sugerencia: "comprobable",
    },
    { original: "incoar", sugerencia: "iniciar" },
    { original: "adverar", sugerencia: "acreditar" },
    { original: "dirimir", sugerencia: "resolver" },
    {
      original: "decaer en su derecho",
      sugerencia: "perder su derecho",
    },
    {
      original: "sírvase proveer",
      sugerencia: "disponga",
    },
    {
      original: "tenor literal",
      sugerencia: "texto literal",
    },
    {
      original: "tengo el agrado de dirigirme",
      sugerencias: ["le escribo para"],
    },
    {
      original: "obra en mi poder",
      sugerencias: ["tengo"],
    },
    {
      original: "elevar una consulta",
      sugerencias: ["consultar", "preguntar"],
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      // Case-insensitive regex con word boundaries
      const pattern = buildAccentInsensitivePattern(item.original);
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
