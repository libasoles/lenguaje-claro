import arcaismosRule from "./arcaismos.js";
import tecnicismosRule from "./tecnicismos.js";
import vaguedadesRule from "./vaguedades.js";
import rodeosRule from "./rodeos.js";
import vozPasivaRule from "./voz-pasiva.js";
import queismoRule from "./queismo.js";
import palabrasExtranasRule from "./palabras-extranas.js";
import nominalizacionRule from "./nominalizacion.js";

export { accentInsensitiveUtils } from "./shared.js";

export const rules = [
  arcaismosRule,
  tecnicismosRule,
  vaguedadesRule,
  rodeosRule,
  vozPasivaRule,
  queismoRule,
  palabrasExtranasRule,
  nominalizacionRule,
];
