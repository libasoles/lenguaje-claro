import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const rodeosRule = {
  id: "rodeos",
  nombre: "Rodeo innecesario",
  descripcion: "Sustituye frases extensas por alternativas concisas",
  color: "#8e44ad", // Morado

  diccionario: [
    { original: "en el momento actual", sugerencias: ["ahora"] },
    { original: "en vista de que", sugerencias: ["por"] },
    { original: "dado el hecho de que", sugerencias: ["porque"] },
    { original: "con motivo de", sugerencias: ["porque"] },
    { original: "como efecto de", sugerencias: ["porque"] },
    { original: "a fin de", sugerencias: ["para"] },
    { original: "con el objeto de", sugerencias: ["para"] },
    { original: "para el propósito de", sugerencias: ["para"] },
    { original: "con la finalidad de", sugerencias: ["para"] },
    { original: "en el entendido de", sugerencias: ["porque", "ya que"] },
    { original: "toda vez que", sugerencias: ["porque", "ya que"] },
    { original: "debido a que", sugerencias: ["porque"] },
    { original: "no obstante el hecho de que", sugerencias: ["aunque", "a pesar de que"] },
    { original: "de conformidad con", sugerencias: ["según", "bajo"] },
    { original: "a considerable distancia", sugerencias: ["lejos"] },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
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

export default rodeosRule;
