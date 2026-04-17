import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const rodeosRule = {
  id: "rodeos",
  nombre: "Rodeo innecesario",
  descripcion: "Sustituye frases extensas por alternativas concisas",
  color: "#8e44ad", // Morado

  diccionario: [
    { original: "en el momento actual", sugerencia: "ahora" },
    { original: "a considerable distancia", sugerencia: "lejos" },
    { original: "de conformidad con", sugerencia: "según" },
    { original: "en vista de que", sugerencia: "por" },
    { original: "no obstante el hecho de que", sugerencia: "aunque" },
    { original: "a fin de", sugerencia: "para" },
    { original: "con el objeto de", sugerencia: "para" },
    { original: "para el propósito de", sugerencia: "para" },
    { original: "con la finalidad de", sugerencia: "para" },
    { original: "dado el hecho de que", sugerencia: "porque" },
    { original: "con motivo de", sugerencia: "porque" },
    { original: "debido a que", sugerencia: "porque" },
    { original: "toda vez que", sugerencia: "porque" },
    { original: "en el entendido de", sugerencia: "porque" },
    { original: "como efecto de", sugerencia: "porque" },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
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

export default rodeosRule;
