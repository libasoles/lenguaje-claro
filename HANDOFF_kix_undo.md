# Handoff — Spike ctrl+z nativo en Google Docs

**Branch:** `feature/native-undo-kix-bridge`
**Estado:** descubierta la API real que usa Grammarly. Falta implementar.

## Lo que tenés que leer primero (en este orden)

1. `~/.claude/projects/-Users-guillermoperez-Projects-playground-lenguaje-claro-chrome-extension/memory/project_kix_spike_status.md` — estado del spike
2. `~/.claude/projects/-Users-guillermoperez-Projects-playground-lenguaje-claro-chrome-extension/memory/reference_grammarly_gdocs_recipe.md` — recipe completa con offsets de archivo de Grammarly
3. `~/.claude/projects/-Users-guillermoperez-Projects-playground-lenguaje-claro-chrome-extension/memory/feedback_no_find_fallback.md` — feedback histórico relevante

## Contexto en una línea

Para que `ctrl+z` revierta los reemplazos, Docs los tiene que aplicar por su pipeline nativo. Grammarly logra eso con dos APIs: `window._docs_annotate_getAnnotatedText(extensionId)` para mover el cursor, y un `InputEvent("beforeinput", {inputType:"insertReplacementText"})` sobre el iframe `iframe.docs-texteventtarget-iframe` para insertar el texto.

## Lo que hay que implementar

### 1. `content/kix-bridge.js` (main world, document_start) — REESCRIBIR

Borrar el patch de `_createKixApplication`. En su lugar:

- Leer `extensionId` de `document.documentElement.dataset.docsReviewerExtId` (escrito por isolated world antes — ver paso 3).
- Esperar a que `window._docs_annotate_getAnnotatedText` exista (poll cada ~50ms, o `Object.defineProperty` setter).
- Cuando aparezca, llamar `window._docs_annotate_getAnnotatedText(extensionId)`, await la Promise, guardar accessor en `window.__docsReviewerAccessor`.
- Escuchar CustomEvents desde isolated world:
  - `docs-reviewer-get-text` → responder con `accessor.getText()` vía `docs-reviewer-text-result`
  - `docs-reviewer-set-selection` (detail: `{start, end}`) → llamar `accessor.setSelection(start, end)`, responder con `docs-reviewer-selection-result` (detail: `{ok}`)
- Loguear todo con prefijo `[Docs Reviewer][kix-bridge]`.

**Fallback** si setSelection retorna falsy (Grammarly lo tiene en `_setSelectionSucceed`): dispatchar un `KeyboardEvent("keydown", {key:"ArrowRight", shiftKey:true, bubbles:true, cancelable:true})` sobre el iframe `iframe.docs-texteventtarget-iframe` (su contentDocument) para "despertar" el sistema de selección, y reintentar `setSelection`.

### 2. `content/docs-editor.js` (isolated world) — IMPLEMENTAR `aplicarReemplazo`

- En `init()`: setear `document.documentElement.dataset.docsReviewerExtId = chrome.runtime.id` **lo antes posible** (este script corre en `document_idle`, así que el bridge — que corre en `document_start` — tiene que poder esperar via polling, no asumir que el dataset ya está). Idea: el bridge polea ambos requisitos (`_docs_annotate_getAnnotatedText` Y el `dataset.docsReviewerExtId`).
- Implementar `aplicarReemplazo({ inicio, fin, textoReemplazo })`:
  1. Validar con `DocsReader.leerTextoCompleto()` que `texto[inicio:fin]` coincide con lo esperado (ver `feedback_no_find_fallback.md`).
  2. Enviar `docs-reviewer-set-selection` con `{start: inicio, end: fin}`. Esperar respuesta `docs-reviewer-selection-result` con `{ok: true}`.
  3. Buscar el iframe: `document.querySelector("iframe.docs-texteventtarget-iframe")`. Su `contentDocument.querySelector('[contenteditable="true"]')` es el target.
  4. Construir y dispatchar:
     ```js
     const dt = new DataTransfer();
     dt.setData("text/plain", textoReemplazo);
     const evt = new InputEvent("beforeinput", {
       inputType: "insertReplacementText",
       data: textoReemplazo,
       dataTransfer: dt,
       cancelable: true,
       bubbles: true,
     });
     editable.dispatchEvent(evt);
     ```
  5. Retornar `{ok: true}` o el error.

### 3. Manifest

`manifest.template.json` ya registra ambos scripts. No hace falta cambiar nada.

### 4. Wiring del panel

`content/panel.js` y `content/content.js` hoy no llaman a `DocsEditor.aplicarReemplazo`. Después del spike, cuando el flujo end-to-end funcione, hay que cablear el botón "Aplicar" del panel para que invoque `DocsEditor.aplicarReemplazo({inicio, fin, textoReemplazo})` con los datos del match seleccionado. **Eso es para después** — primero confirmar que el mecanismo funciona desde DevTools.

## Cómo verificar que funciona

1. Cargar la extensión en `chrome://extensions` (modo dev, "Reload" si ya estaba).
2. Abrir un Google Doc real con Grammarly **deshabilitado** (Grammarly también patchea estas APIs y puede interferir).
3. Abrir DevTools en el doc.
4. Verificar en consola: `window.__docsReviewerAccessor` no es null.
5. Probar manual: `await window.__docsReviewerAccessor.getText()` → debería retornar `{fullText, ...}`.
6. Probar selección: `window.__docsReviewerAccessor.setSelection(0, 5)` → debería seleccionar los primeros 5 chars en el doc.
7. Desde isolated world (`DocsEditor` está en `window`): `await DocsEditor.aplicarReemplazo({inicio: 0, fin: 5, textoReemplazo: "HOLA "})` → texto cambia.
8. **Apretar `ctrl+z`**: el cambio se revierte. Si no se revierte, el spike falló.

## Puntos donde es probable que se rompa

- **`_docs_annotate_getAnnotatedText` no existe**: Docs lo expone solo después de un load completo. Polear durante varios segundos antes de dar por perdido.
- **El extension ID falla**: si Docs valida whitelist de IDs (no se confirmó), va a haber que investigar. Workaround: usar el ID de Grammarly como prueba (no para producción) — `kbfnbcaeplbcioakkpcpgfkobkghlhen`.
- **El iframe no existe todavía**: aparece cuando el editor termina de cargar. Esperar via MutationObserver o polling.
- **`setSelection` retorna false**: usar el fallback de keydown ArrowRight (descrito arriba).
- **El InputEvent no aplica el cambio**: verificar que el target sea el `[contenteditable]` *dentro* del iframe, no el iframe en sí.
- **El undo se rompe**: si el cambio se aplica pero ctrl+z no lo revierte, significa que el InputEvent llegó pero Docs no lo procesó por su pipeline nativo. Revisar inputType y dataTransfer.

## Qué borrar al finalizar

Cuando el spike funcione end-to-end y todo esté cableado:

- Borrar este `HANDOFF_kix_undo.md`.
- Revisar el plan en `~/.claude/plans/es-de-vital-importancia-clever-hickey.md` y marcar Fase 0 completa.
- Actualizar `project_kix_spike_status.md` para reflejar éxito.
- Sacar logs `console.log` de debugging en `kix-bridge.js` y `docs-editor.js` (dejar solo errores).

## Restricciones del usuario

- Branch actual `feature/native-undo-kix-bridge`. **No mergear a main sin pedir aprobación** (ver `feedback_git_workflow.md`).
- **No** intentar el flujo de Find/Replace de Docs como fallback (ver `feedback_no_find_fallback.md`).
