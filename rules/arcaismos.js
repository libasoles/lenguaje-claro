import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const arcaismosRule = {
  id: "arcaismos",
  nombre: "Arcaísmo innecesario",
  descripcion: "Sustituye términos obsoletos por lenguaje actual",
  color: "#f1c40f", // Amarillo

  // Diccionario de arcaísmos
  diccionario: [
    { original: "in fine", sugerencias: ["al final"] },
    {
      original: "a sensu contrario",
      sugerencias: ["en sentido contrario"],
    },
    {
      original: "viene en decidir",
      sugerencias: ["se decide"],
    },
    {
      original: "otrosí digo",
      sugerencias: ["además solicito"],
    },
    {
      original: "susodicho",
      sugerencias: ["mencionado"],
    },
    {
      original: "infraescrito",
      sugerencias: ["quien firma"],
    },
    {
      original: "fehaciente",
      sugerencias: ["comprobable"],
    },
    { original: "incoar", sugerencias: ["iniciar"] },
    { original: "adverar", sugerencias: ["acreditar"] },
    { original: "dirimir", sugerencias: ["resolver"] },
    {
      original: "decaer en su derecho",
      sugerencias: ["perder su derecho"],
    },
    {
      original: "sírvase proveer",
      sugerencias: ["disponga"],
    },
    {
      original: "tenor literal",
      sugerencias: ["texto literal"],
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
        const sugerencias = item.sugerencias.map((s) => mantenerCase(match[0], s));
        const sugerencia = sugerencias[0];
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia,
          sugerencias,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por "${sugerencia}"`,
        });
      }
    });

    return matches;
  },
};

export default arcaismosRule;
