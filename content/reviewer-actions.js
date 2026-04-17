let reviewerActions = {
  activeIssueId: null,
  analizarDocumento: async () => {},
  aplicarCorreccion: async () => {},
  setIssueActivo: () => {},
  limpiarIssueActivo: () => {},
  enfocarIssue: () => false,
  getIssue: () => null,
};

export function setReviewerActions(nextActions) {
  reviewerActions = {
    ...reviewerActions,
    ...nextActions,
  };
}

export function getReviewerActions() {
  return reviewerActions;
}
