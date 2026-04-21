const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

function loadBrowserModule({
  projectRoot,
  source,
  sandbox = {},
  globalName = "__testModule",
  filename = "__test-entry__.js",
}) {
  const result = buildSync({
    stdin: {
      contents: source,
      resolveDir: projectRoot,
      sourcefile: filename,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    globalName,
    jsxFactory: "h",
  });

  const context = vm.createContext({ ...sandbox });
  vm.runInContext(result.outputFiles[0].text, context, {
    filename: path.join(projectRoot, filename),
  });

  return {
    exports: context[globalName],
    sandbox: context,
  };
}

module.exports = { loadBrowserModule };
