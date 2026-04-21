import arcaismosRule from "./arcaismos/rule.js";
import tecnicismosRule from "./tecnicismos/rule.js";
import vaguedadesRule from "./vaguedades/rule.js";
import rodeosRule from "./rodeos/rule.js";
import vozPasivaRule from "./voz-pasiva/rule.js";
import queismoRule from "./queismo/rule.js";
import nominalizacionRule from "./nominalizacion/rule.js";
import numerosRule from "./numeros/rule.js";
import siglasRule from "./siglas/rule.js";
import type { Rule } from "./types.js";

export { accentInsensitiveUtils } from "./shared.js";
export type {
  Confidence,
  HallazgoTipo,
  Match,
  Pattern,
  QueismoPattern as QueismoPatternEntry,
  QueismoPatterns,
  Rule,
  VaguedadPattern,
} from "./types.js";

export const rules: Rule[] = [
  arcaismosRule,
  tecnicismosRule,
  vaguedadesRule,
  rodeosRule,
  vozPasivaRule,
  queismoRule,
  nominalizacionRule,
  numerosRule,
  siglasRule,
];
