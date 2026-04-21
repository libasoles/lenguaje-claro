import type { Match, Rule } from "../types.js";

const siglasConPuntosRegex = /\b([A-Z]\.){2,}[A-Z]?\b/g;

const siglasRule = {
  id: "siglas-sin-puntos",
  nombre: "Siglas sin puntos",
  descripcion:
    "Detecta siglas escritas con puntos y sugiere la forma correcta (sin puntos).",
  color: "#8e44ad",
  detectar(texto: string): Match[] {
    const resultados: Match[] = [];
    let match;
    while ((match = siglasConPuntosRegex.exec(texto)) !== null) {
      const textoOriginal = match[0];
      // Sugerencia: quitar los puntos
      const sugerencia = textoOriginal.replace(/\./g, "");
      resultados.push({
        id: `siglas-sin-puntos-${match.index}`,
        inicio: match.index,
        fin: match.index + textoOriginal.length,
        textoOriginal,
        sugerencias: [sugerencia],
        regla: "siglas-sin-puntos",
        descripcion: `Las siglas deben escribirse sin puntos: ${sugerencia}`,
      });
    }
    return resultados;
  },
} satisfies Rule;

export default siglasRule;
