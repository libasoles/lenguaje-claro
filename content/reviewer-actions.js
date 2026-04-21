// TODO: tener un placeholder de acciones es un smell
let accionesReviewer = {
  activeIssueId: null,
  analizarDocumento: async () => {},
  aplicarCorreccion: async () => {},
  establecerIssueActivo: () => {},
  limpiarIssueActivo: () => {},
  enfocarIssue: () => false,
  obtenerIssue: () => null,
};

export function establecerAccionesReviewer(nextActions) {
  accionesReviewer = nextActions || accionesReviewer;
}

export function obtenerAccionesReviewer() {
  return accionesReviewer;
}
