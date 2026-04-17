import arcaismosRule from "./arcaismos.js";
import tecnicismosRule from "./tecnicismos.js";
import vaguedadesRule from "./vaguedades.js";
import vozPasivaRule from "./voz-pasiva.js";
import queismoRule from "./queismo.js";

export { accentInsensitiveUtils } from "./shared.js";

export const rules = [
  arcaismosRule,
  tecnicismosRule,
  vaguedadesRule,
  vozPasivaRule,
  queismoRule,
];
