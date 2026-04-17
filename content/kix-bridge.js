// Runs in MAIN world at document_start.
// Intercepta funciones globales que Google Docs usa para bootstrapping del editor kix
// y captura la instancia del editor. Expone la instancia bajo window.__docsReviewerKix
// para inspección desde DevTools (fase de spike) y dispatcha un CustomEvent hacia el
// content script isolated world cuando la instancia está lista.
//
// Referencia: Grammarly hace este mismo patrón patchando `_createKixApplication`.
// Como los nombres internos del editor cambian con los updates de Docs, también
// monitoreamos candidatos alternativos y logueamos todo para facilitar el reverse.

(function () {
  'use strict';

  const PREFIX = '[Docs Reviewer][kix-bridge]';
  const CANDIDATE_FACTORIES = [
    '_createKixApplication',
    '_docs_flag_initialData',
  ];

  let capturedInstance = null;
  let capturedFrom = null;

  function describeInstance(instance) {
    const summary = {
      ownProps: [],
      protoMethods: [],
      ctorName: null,
    };

    try {
      summary.ownProps = Object.getOwnPropertyNames(instance || {});
    } catch (_) {}

    try {
      const proto = Object.getPrototypeOf(instance);
      if (proto) {
        summary.protoMethods = Object.getOwnPropertyNames(proto);
        summary.ctorName = (proto.constructor && proto.constructor.name) || null;
      }
    } catch (_) {}

    return summary;
  }

  function captureInstance(source, instance) {
    if (!instance || capturedInstance) return;

    capturedInstance = instance;
    capturedFrom = source;
    window.__docsReviewerKix = instance;

    const summary = describeInstance(instance);
    console.log(
      `${PREFIX} captured kix instance via "${source}" ` +
        `(ctor=${summary.ctorName}, own=${summary.ownProps.length}, proto=${summary.protoMethods.length}). ` +
        `Inspect via window.__docsReviewerKix`,
    );
    console.log(`${PREFIX} own props:`, summary.ownProps);
    console.log(`${PREFIX} proto methods:`, summary.protoMethods);

    document.dispatchEvent(
      new CustomEvent('docs-reviewer-kix-ready', {
        detail: { source },
      }),
    );
  }

  function wrapFn(name, fn) {
    if (typeof fn !== 'function') return fn;
    const wrapped = function () {
      const instance = fn.apply(this, arguments);
      console.log(
        `${PREFIX} ${name} invoked — return type=${typeof instance}, truthy=${Boolean(instance)}`,
      );
      if (instance && !capturedInstance) {
        captureInstance(name, instance);
      }
      return instance;
    };
    try {
      Object.defineProperty(wrapped, 'name', { value: fn.name || name });
    } catch (_) {}
    return wrapped;
  }

  function wrapFactory(name) {
    try {
      const existing = Object.getOwnPropertyDescriptor(window, name);
      if (existing && !existing.configurable) {
        console.warn(`${PREFIX} cannot patch non-configurable ${name}`);
        return;
      }

      let current = wrapFn(name, window[name]);
      console.log(
        `${PREFIX} initial value of ${name}: type=${typeof window[name]}, ` +
          `already-wrapped=${current !== window[name]}`,
      );

      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = wrapFn(name, value);
          console.log(
            `${PREFIX} ${name} reassigned (type=${typeof value}) and rewrapped`,
          );
        },
      });
    } catch (error) {
      console.warn(`${PREFIX} failed to patch ${name}:`, error);
    }
  }

  CANDIDATE_FACTORIES.forEach(wrapFactory);

  // Permite al isolated content script consultar el estado desde su mundo.
  document.addEventListener('docs-reviewer-kix-query', function () {
    document.dispatchEvent(
      new CustomEvent('docs-reviewer-kix-ready', {
        detail: {
          source: capturedFrom || null,
          captured: Boolean(capturedInstance),
        },
      }),
    );
  });

  console.log(`${PREFIX} hooks installed at document_start`);
})();
