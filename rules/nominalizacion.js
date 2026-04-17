import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const nominalizacionRule = {
  id: "nominalizacion",
  nombre: "Nominalización",
  descripcion:
    "Usa el verbo directamente en lugar de una construcción sustantivada",
  color: "#16a085", // Verde azulado

  diccionario: [
    {
      original: "poner en consideración",
      sugerencias: ["considerar"],
    },
    {
      original: "dar comienzo",
      sugerencias: ["comenzar", "empezar"],
    },
    {
      original: "llegar a la conclusión",
      sugerencias: ["concluir"],
    },
    {
      original: "poner de manifiesto",
      sugerencias: ["manifestar", "decir", "exponer"],
    },
    {
      original: "mantuvieron una reunión",
      sugerencias: ["se reunieron"],
    },
    {
      original: "proceder a la entrega",
      sugerencias: ["entregar"],
    },
    {
      original: "realizar una inspección",
      sugerencias: ["inspeccionar"],
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.original);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        const sugerencia = mantenerCase(match[0], item.sugerencias[0]);
        const sugerencias = item.sugerencias.map((s) =>
          mantenerCase(match[0], s),
        );
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

export default nominalizacionRule;
