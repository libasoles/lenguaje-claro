import { buildAccentInsensitivePattern } from "../shared.js";
import type { Match, Rule, VaguedadPattern } from "../types.js";
import diccionario from "./patterns.json";

interface VaguedadMatch extends Match {
  aplicable: false;
}

type VaguedadRule = Rule & {
  diccionario: VaguedadPattern[];
};

export const vaguedadesRule = {
  id: "vaguedades",
  nombre: "Vaguedad",
  descripcion:
    "Reemplaza expresiones vagas por información precisa y verificable",
  color: "#8e44ad", // Violeta

  // `precision` explica qué tipo de información concreta reemplazaría la vaguedad.
  // No se puede sugerir un texto exacto, por eso `aplicable: false`.

  // TODO: da falsos positivos, como "responsabilidad alguna", "algún modo", "alguna manera", "alguna vez", "pronto llegará el verano",
  diccionario,

  detectar(texto: string): VaguedadMatch[] {
    const matches: VaguedadMatch[] = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.original);
      const regex =
        item.original === "muchas"
          ? new RegExp(`\\b${pattern}\\b(?!\\s+gracias\\b)`, "gi")
          : new RegExp(`\\b${pattern}\\b`, "gi");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(texto)) !== null) {
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencias: [item.precision],
          aplicable: false,
          regla: this.id,
          descripcion: `"${match[0]}" es una expresión vaga`,
        });
      }
    });

    return matches;
  },
} satisfies VaguedadRule;

export default vaguedadesRule;
