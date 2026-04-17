import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const palabrasExtranasRule = {
  id: "palabras-extranas",
  nombre: "Palabra extraña",
  descripcion: "Sustituye palabras poco comunes por alternativas más claras",
  color: "#e67e22", // Naranja

  diccionario: [
    // TODO; overlap con tecnicismos
    { original: "empero", sugerencia: "sin embargo", palabrasClaves: "empero" },
    { original: "dilación", sugerencia: "demora", palabrasClaves: "dilación" },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
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

export default palabrasExtranasRule;
