const DOC_URL_RE = /^https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/;

const toggleDoc = document.getElementById("toggle-doc");
const toggleGlobal = document.getElementById("toggle-global");
const rowDoc = document.getElementById("row-doc");
const docSubtitle = document.getElementById("doc-subtitle");
const reloadHint = document.getElementById("reload-hint");

let currentDocId = null;
let currentTabId = null;
let initialState = null;

async function obtenerPestanaActiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function leerEstado() {
  const { extensionEnabled = true, disabledDocs = [] } =
    await chrome.storage.local.get(["extensionEnabled", "disabledDocs"]);
  return { extensionEnabled, disabledDocs };
}

function estadoFirma(estado, docId) {
  const deshabilitadoEnDoc = docId ? estado.disabledDocs.includes(docId) : false;
  return `${estado.extensionEnabled ? 1 : 0}|${deshabilitadoEnDoc ? 1 : 0}`;
}

function marcarRecargaSiCambio(estado) {
  if (!initialState) return;
  const cambio = estadoFirma(estado, currentDocId) !== initialState;
  reloadHint.hidden = !cambio;
}

async function render() {
  const tab = await obtenerPestanaActiva();
  currentTabId = tab?.id ?? null;
  const match = tab?.url ? tab.url.match(DOC_URL_RE) : null;
  currentDocId = match ? match[1] : null;

  const estado = await leerEstado();

  if (currentDocId) {
    rowDoc.hidden = false;
    docSubtitle.hidden = true;
    docSubtitle.textContent = "";
    rowDoc.setAttribute("aria-disabled", "false");
    toggleDoc.disabled = !estado.extensionEnabled;
    toggleDoc.checked =
      estado.extensionEnabled && !estado.disabledDocs.includes(currentDocId);
  } else {
    rowDoc.hidden = true;
  }

  toggleGlobal.checked = estado.extensionEnabled;

  initialState = estadoFirma(estado, currentDocId);
}

toggleGlobal.addEventListener("change", async () => {
  await chrome.storage.local.set({ extensionEnabled: toggleGlobal.checked });
  const estado = await leerEstado();
  if (currentDocId) {
    toggleDoc.disabled = !estado.extensionEnabled;
    toggleDoc.checked =
      estado.extensionEnabled && !estado.disabledDocs.includes(currentDocId);
  }
  marcarRecargaSiCambio(estado);
});

toggleDoc.addEventListener("change", async () => {
  if (!currentDocId) return;
  const estado = await leerEstado();
  const set = new Set(estado.disabledDocs);
  if (toggleDoc.checked) {
    set.delete(currentDocId);
  } else {
    set.add(currentDocId);
  }
  const disabledDocs = [...set];
  await chrome.storage.local.set({ disabledDocs });
  marcarRecargaSiCambio({ ...estado, disabledDocs });
});

render();
