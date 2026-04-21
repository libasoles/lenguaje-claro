import { buildAccentInsensitivePattern, mantenerCase } from "../shared.js";
import type { Match, Rule, TituloHonorificoPattern } from "../types.js";
import rawDiccionario from "./patterns.json";

type MatchDraft = Omit<Match, "id" | "regla">;

type TitulosHonorificosRule = Rule & {
  diccionario: TituloHonorificoPattern[];
  _crearRegex(item: TituloHonorificoPattern): RegExp;
  _crearAdvertencia(item: TituloHonorificoPattern, textoOriginal: string): string;
  _deduplicar(matches: MatchDraft[]): MatchDraft[];
};

const WORD_CHAR_CLASS = String.raw`\p{L}\p{N}_`;
const DEFAULT_WARNING =
  "Evitá tratamientos honoríficos o cuasi-nobiliarios. Usá el cargo, el órgano o el nombre de forma directa.";

export const titulosHonorificosRule = {
  id: "titulos-honorificos",
  nombre: "Títulos honoríficos",
  descripcion:
    "Detecta tratamientos honoríficos o cuasi-nobiliarios y sugiere una forma directa",
  color: "#c0392b",

  diccionario: rawDiccionario as TituloHonorificoPattern[],

  _crearRegex(item: TituloHonorificoPattern): RegExp {
    const pattern = item.regex || buildAccentInsensitivePattern(item.original);
    return new RegExp(
      `(^|[^${WORD_CHAR_CLASS}])(${pattern})(?![${WORD_CHAR_CLASS}])`,
      "giu",
    );
  },

  _crearAdvertencia(
    item: TituloHonorificoPattern,
    textoOriginal: string,
  ): string {
    return item.advertencia || `${textoOriginal}: ${DEFAULT_WARNING}`;
  },

  _deduplicar(matches: MatchDraft[]): MatchDraft[] {
    const sorted = [...matches].sort((a, b) => {
      if (a.inicio !== b.inicio) return a.inicio - b.inicio;
      return b.fin - b.inicio - (a.fin - a.inicio);
    });

    const kept: MatchDraft[] = [];
    sorted.forEach((match) => {
      const contained = kept.some(
        (accepted) =>
          accepted.inicio <= match.inicio && match.fin <= accepted.fin,
      );
      if (!contained) kept.push(match);
    });

    return kept.sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  },

  detectar(texto: string): Match[] {
    const matches: MatchDraft[] = [];

    this.diccionario.forEach((item) => {
      const regex = this._crearRegex(item);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(texto)) !== null) {
        const prefix = match[1] || "";
        const textoOriginal = match[2];
        const inicio = match.index + prefix.length;
        const fin = inicio + textoOriginal.length;
        const tieneSugerencias =
          Array.isArray(item.sugerencias) && item.sugerencias.length > 0;
        const aplicable = tieneSugerencias && item.aplicable !== false;
        const sugerencias = tieneSugerencias
          ? item.sugerencias!.map((s) => mantenerCase(textoOriginal, s))
          : [this._crearAdvertencia(item, textoOriginal)];

        matches.push({
          inicio,
          fin,
          textoOriginal,
          sugerencias,
          ...(aplicable ? {} : { aplicable: false }),
          descripcion: aplicable
            ? `Reemplazar "${textoOriginal}" por "${sugerencias[0]}"`
            : `"${textoOriginal}" usa un tratamiento honorífico o cuasi-nobiliario`,
        });
      }
    });

    return this._deduplicar(matches).map((match, index) => ({
      ...match,
      id: `${this.id}-${index}`,
      regla: this.id,
    }));
  },
} satisfies TitulosHonorificosRule;

export default titulosHonorificosRule;
