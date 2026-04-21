// content/jsx-runtime.js
// Simple JSX factory for vanilla DOM (no React)
// Lista de etiquetas SVG conocidas
const SVG_TAGS = [
  "svg",
  "path",
  "circle",
  "rect",
  "g",
  "line",
  "ellipse",
  "polygon",
  "polyline",
  "text",
  "defs",
  "clipPath",
  "use",
  "symbol",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feSpecularLighting",
  "feTile",
  "feTurbulence",
];

const Fragment = Symbol("Fragment");

function h(type, props, ...children) {
  if (type === Fragment) {
    return children.flat(Infinity);
  }

  if (typeof type === "function") {
    return type({ ...(props || {}), children });
  }

  return _h(type, props, children, false);
}

function applyStyle(el, value) {
  if (typeof value === "string") {
    el.setAttribute("style", value);
    return;
  }

  Object.entries(value || {}).forEach(([name, styleValue]) => {
    if (styleValue == null || styleValue === false) return;

    if (name.startsWith("--")) {
      el.style.setProperty(name, String(styleValue));
      return;
    }

    el.style[name] = styleValue;
  });
}

function appendChild(el, child, isSVG) {
  if (child == null || child === false || child === true) return;

  if (Array.isArray(child)) {
    child.forEach((nestedChild) => appendChild(el, nestedChild, isSVG));
    return;
  }

  if (typeof child === "string" || typeof child === "number") {
    el.appendChild(document.createTextNode(child));
    return;
  }

  if (typeof Node !== "undefined" && child instanceof Node) {
    el.appendChild(child);
    return;
  }

  if (child && typeof child === "object" && child.type) {
    el.appendChild(_h(child.type, child.props, child.children || [], isSVG));
  }
}

function _h(type, props, children, parentIsSVG) {
  const isSVG = parentIsSVG || SVG_TAGS.includes(type);
  const el = isSVG
    ? document.createElementNS("http://www.w3.org/2000/svg", type)
    : document.createElement(type);
  for (const [key, value] of Object.entries(props || {})) {
    if (
      key === "children" ||
      key === "key" ||
      value == null ||
      value === false
    ) {
      continue;
    }

    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dangerouslySetInnerHTML") {
      el.innerHTML = value?.__html ?? "";
    } else if (key === "style" && typeof value === "object") {
      applyStyle(el, value);
    } else if (key === "className") {
      if (isSVG) {
        el.setAttribute("class", value);
      } else {
        el.className = value;
      }
    } else {
      // Convertir camelCase a kebab-case para atributos SVG
      let attr = key;
      if (isSVG && /[A-Z]/.test(key)) {
        attr = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      }
      if (isSVG && attr === "xlink:href") {
        el.setAttributeNS("http://www.w3.org/1999/xlink", "href", value);
      } else if (value === true) {
        el.setAttribute(attr, "");
      } else {
        el.setAttribute(attr, value);
      }
    }
  }
  children.forEach((child) => appendChild(el, child, isSVG));
  return el;
}
// Expose globally for JSX transpilation
const globalScope = typeof window !== "undefined" ? window : globalThis;
globalScope.h = h;
globalScope.Fragment = Fragment;
