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
      palabrasClaves: "poner en consideración",
    },
    {
      original: "dar comienzo",
      sugerencias: ["comenzar", "empezar"],
      palabrasClaves: "dar comienzo",
    },
    {
      original: "llegar a la conclusión",
      sugerencias: ["concluir"],
      palabrasClaves: "llegar a la conclusión",
    },
    {
      original: "poner de manifiesto",
      sugerencias: ["manifestar", "decir", "exponer"],
      palabrasClaves: "poner de manifiesto",
    },
    {
      original: "mantuvieron una reunión",
      sugerencias: ["se reunieron"],
      palabrasClaves: "mantuvieron una reunión",
    },
    {
      original: "proceder a la entrega",
      sugerencias: ["entregar"],
      palabrasClaves: "proceder a la entrega",
    },
    {
      original: "realizar una inspección",
      sugerencias: ["inspeccionar"],
      palabrasClaves: "realizar una inspección",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.palabrasClaves);
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
