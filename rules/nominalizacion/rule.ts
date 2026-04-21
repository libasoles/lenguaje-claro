import { buildAccentInsensitivePattern, mantenerCase } from "../shared.js";
import type { Match, Pattern, Rule } from "../types.js";
import diccionario from "./patterns.json";

type ReplacementRule = Rule & {
  diccionario: Pattern[];
};

export const nominalizacionRule = {
  id: "nominalizacion",
  nombre: "Nominalización",
  descripcion:
    "Usa el verbo directamente en lugar de una construcción sustantivada",
  color: "#16a085",
  diccionario,
  detectar(texto: string): Match[] {
    const matches: Match[] = [];
    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.original);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(texto)) !== null) {
        const matchedText = match[0];
        const sugerencias = item.sugerencias.map((s) =>
          mantenerCase(matchedText, s),
        );
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + matchedText.length,
          textoOriginal: matchedText,
          sugerencias,
          regla: this.id,
          descripcion: `Reemplazar "${matchedText}" por "${sugerencias[0]}"`,
        });
      }
    });
    return matches;
  },
} satisfies ReplacementRule;

export default nominalizacionRule;
