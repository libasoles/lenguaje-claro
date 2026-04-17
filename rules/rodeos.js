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
    { original: "con el objeto de", sugerencia: "para" },
    { original: "para el propósito de", sugerencia: "para" },
    { original: "con la finalidad de", sugerencia: "para" },
    { original: "dado el hecho de que", sugerencia: "porque" },
    { original: "con motivo de", sugerencia: "porque" },
    { original: "debido a que", sugerencia: "porque" },
    { original: "toda vez que", sugerencia: "porque" },
    { original: "en el entendido de", sugerencia: "porque" },
    { original: "como efecto de", sugerencia: "porque" },
    {
      original: "a fin de",
      sugerencias: ["para"],
      palabrasClaves: "a fin de",
    },
    {
      original: "con el objeto de",
      sugerencias: ["para"],
      palabrasClaves: "con el objeto de",
    },
    {
      original: "para el propósito de",
      sugerencias: ["para"],
      palabrasClaves: "para el propósito de",
    },
    {
      original: "con la finalidad de",
      sugerencias: ["para"],
      palabrasClaves: "con la finalidad de",
    },
    {
      original: "en el entendido de",
      sugerencias: ["porque", "ya que"],
      palabrasClaves: "en el entendido de",
    },
    {
      original: "toda vez que",
      sugerencias: ["porque", "ya que"],
      palabrasClaves: "toda vez que",
    },
    {
      original: "debido a que",
      sugerencias: ["porque"],
      palabrasClaves: "debido a que",
    },
    {
      original: "no obstante el hecho de que",
      sugerencias: ["aunque", "a pesar de que"],
      palabrasClaves: "no obstante el hecho de que",
    },
    {
      original: "de conformidad con",
      sugerencias: ["según", "bajo"],
      palabrasClaves: "de conformidad con",
    },
    {
      original: "a considerable distancia",
      sugerencias: ["lejos"],
      palabrasClaves: "a considerable distancia",
    },
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
