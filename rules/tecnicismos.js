import { buildAccentInsensitivePattern, mantenerCase } from "./shared.js";

export const tecnicismosRule = {
  id: "tecnicismos",
  nombre: "Tecnicismo",
  descripcion: "Reemplaza términos técnicos por lenguaje llano",
  color: "#e67e22", // Naranja

  // Cada entrada puede tener `sugerencias` (array) para ofrecer múltiples opciones.
  // Si solo hay una opción, usar un array de un elemento igualmente.
  diccionario: [
    {
      original: "prestatario",
      sugerencias: ["persona que recibe un préstamo"],
      palabrasClaves: "prestatario",
    },
    {
      original: "expiración",
      sugerencias: ["vencimiento"],
      palabrasClaves: "expiración",
    },
    {
      original: "mora",
      sugerencias: ["retraso", "aplazamiento"],
      palabrasClaves: "mora",
    },
    {
      original: "enajenar",
      sugerencias: ["vender", "transmitir"],
      palabrasClaves: "enajenar",
    },
    {
      original: "enajenación",
      sugerencias: ["venta", "transmisión"],
      palabrasClaves: "enajenación",
    },
    {
      original: "empero",
      sugerencias: ["sin embargo"],
      palabrasClaves: "empero",
    },
    {
      original: "dilación",
      sugerencias: ["demora"],
      palabrasClaves: "dilación",
    },
    {
      original: "per cápita",
      sugerencias: ["por persona"],
      palabrasClaves: "per cápita",
    },
    {
      original: "cláusula penal",
      sugerencias: ["penalidad por incumplimiento"],
      palabrasClaves: "cláusula penal",
    },
    {
      original: "acreedor",
      sugerencias: [
        "quien presta el dinero",
        "quien tiene el derecho a cobrar",
      ],
      palabrasClaves: "acreedor",
    },
    {
      original: "deudor",
      sugerencias: [
        "quien debe el dinero",
        "quien tiene la obligación de pagar",
      ],
      palabrasClaves: "deudor",
    },
    {
      original: "rescisión",
      sugerencias: ["cancelación", "terminación"],
      palabrasClaves: "rescisión",
    },
    {
      original: "resolución",
      sugerencias: ["cancelación", "terminación"],
      palabrasClaves: "resolución",
    },
    {
      original: "suscribir",
      sugerencias: ["firmar"],
      palabrasClaves: "suscribir",
    },
    {
      original: "suscripto",
      sugerencias: ["firmado"],
      palabrasClaves: "suscripto",
    },
    {
      original: "fojas",
      sugerencias: ["páginas", "hojas"],
      palabrasClaves: "fojas",
    },
    {
      original: "notificar",
      sugerencias: ["avisar", "comunicar"],
      palabrasClaves: "notificar",
    },
    {
      original: "arbitrar los medios",
      sugerencias: ["hacer lo necesario", "gestionar"],
      palabrasClaves: "arbitrar los medios",
    },
    {
      original: "erogación",
      sugerencias: ["gasto", "pago"],
      palabrasClaves: "erogación",
    },
    {
      original: "fehacientemente",
      sugerencias: ["de forma comprobable", "formalmente"],
      palabrasClaves: "fehacientemente",
    },
    {
      original: "autógrafa",
      sugerencias: ["firma de puño y letra"],
      palabrasClaves: "autógrafa",
    },
  ],

  detectar(texto) {
    const matches = [];

    this.diccionario.forEach((item) => {
      const pattern = buildAccentInsensitivePattern(item.palabrasClaves);
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match;

      while ((match = regex.exec(texto)) !== null) {
        const sugerencias = item.sugerencias.map((s) =>
          mantenerCase(match[0], s),
        );
        matches.push({
          id: `${this.id}-${matches.length}`,
          inicio: match.index,
          fin: match.index + match[0].length,
          textoOriginal: match[0],
          sugerencia: sugerencias[0],
          sugerencias,
          regla: this.id,
          descripcion: `Reemplazar "${match[0]}" por lenguaje más claro`,
        });
      }
    });

    return matches;
  },
};

export default tecnicismosRule;
