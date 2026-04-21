#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const IS_WATCH = process.argv.includes("--watch");
const IS_PRODUCTION = process.argv.includes("--production");

const ENTRY_POINTS = [
  path.join(ROOT, "background.js"),
  path.join(ROOT, "content", "canvas-interceptors.js"),
  path.join(ROOT, "content", "kix-bridge.js"),
  path.join(ROOT, "content", "index.js"),
];

const STATIC_TARGETS = [
  { from: path.join(ROOT, "assets"), to: path.join(DIST, "assets") },
  { from: path.join(ROOT, "vendor"), to: path.join(DIST, "vendor") },
  { from: path.join(ROOT, "panel"), to: path.join(DIST, "panel") },
  { from: path.join(ROOT, "popup"), to: path.join(DIST, "popup") },
  {
    from: path.join(ROOT, "content", "highlighter-modules"),
    to: path.join(DIST, "content", "highlighter-modules"),
  },
  {
    from: path.join(ROOT, "content", "panel.css"),
    to: path.join(DIST, "content", "panel.css"),
  },
  {
    from: path.join(ROOT, "rules", "queismo", "patterns.json"),
    to: path.join(DIST, "rules", "queismo", "patterns.json"),
  },
];

const STATIC_WATCH_PATHS = [
  path.join(ROOT, IS_PRODUCTION ? ".env.production" : ".env"),
  path.join(ROOT, "manifest.template.json"),
  path.join(ROOT, "assets"),
  path.join(ROOT, "vendor"),
  path.join(ROOT, "content", "highlighter-modules"),
  path.join(ROOT, "panel"),
  path.join(ROOT, "popup"),
  path.join(ROOT, "rules", "queismo", "patterns.json"),
];

function stripTemplateComments(value) {
  if (Array.isArray(value)) {
    return value.map(stripTemplateComments);
  }

  if (value && typeof value === "object") {
    const result = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (!key.startsWith("_comment")) {
        result[key] = stripTemplateComments(nestedValue);
      }
    });
    return result;
  }

  return value;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readEnvFile() {
  const envFile = IS_PRODUCTION ? ".env.production" : ".env";
  const envPath = path.join(ROOT, envFile);
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `No se encontró ${envFile}. Definí CHROME_OAUTH_CLIENT_ID en ese archivo.`,
    );
  }

  const envVars = {};
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      envVars[key] = value;
    });

  if (!envVars.CHROME_OAUTH_CLIENT_ID) {
    throw new Error("Definí CHROME_OAUTH_CLIENT_ID en .env.");
  }

  return envVars;
}

function buildManifest() {
  const envVars = readEnvFile();
  const templatePath = path.join(ROOT, "manifest.template.json");
  const template = fs.readFileSync(templatePath, "utf8");
  const manifestWithClientId = template.replace(
    "__CHROME_OAUTH_CLIENT_ID__",
    envVars.CHROME_OAUTH_CLIENT_ID,
  );
  const manifestObject = stripTemplateComments(
    JSON.parse(manifestWithClientId),
  );

  ensureDir(DIST);
  fs.writeFileSync(
    path.join(DIST, "manifest.json"),
    JSON.stringify(manifestObject, null, 2) + "\n",
    "utf8",
  );
}

function syncPath(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  }

  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isDirectory()) {
    ensureDir(targetPath);
    const sourceEntries = new Set(fs.readdirSync(sourcePath));

    for (const existingEntry of fs.readdirSync(targetPath)) {
      if (!sourceEntries.has(existingEntry)) {
        fs.rmSync(path.join(targetPath, existingEntry), {
          recursive: true,
          force: true,
        });
      }
    }

    sourceEntries.forEach((entry) => {
      syncPath(path.join(sourcePath, entry), path.join(targetPath, entry));
    });
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function syncStaticAssets() {
  STATIC_TARGETS.forEach(({ from, to }) => syncPath(from, to));
}

function refreshStaticArtifacts() {
  buildManifest();
  syncStaticAssets();
}

function createBuildOptions() {
  return {
    entryPoints: ENTRY_POINTS,
    outdir: DIST,
    outbase: ROOT,
    bundle: true,
    format: "iife",
    platform: "browser",
    sourcemap: true,
    logLevel: "info",
    jsxFactory: "h",
    plugins: [
      {
        name: "docs-reviewer-static-sync",
        setup(build) {
          build.onStart(() => {
            refreshStaticArtifacts();
          });
        },
      },
    ],
  };
}

function logBuildMode(mode) {
  console.log(`[build] ${mode} -> ${path.relative(ROOT, DIST)}`);
}

function debounce(fn, delayMs) {
  let timer = null;

  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}

function buildPathSignature(targetPath, relativePath = "") {
  if (!fs.existsSync(targetPath)) {
    return [`${relativePath}:missing`];
  }

  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    const entries = fs.readdirSync(targetPath).sort();
    const directoryEntries = [`${relativePath || "."}:dir`];

    entries.forEach((entry) => {
      directoryEntries.push(
        ...buildPathSignature(
          path.join(targetPath, entry),
          path.join(relativePath, entry),
        ),
      );
    });

    return directoryEntries;
  }

  return [`${relativePath}:file:${stats.size}:${stats.mtimeMs}`];
}

function getStaticWatchSignature() {
  return STATIC_WATCH_PATHS.map((watchPath) =>
    buildPathSignature(watchPath, path.relative(ROOT, watchPath)).join("|"),
  ).join("||");
}

async function runWatch() {
  fs.rmSync(DIST, { recursive: true, force: true });
  ensureDir(DIST);
  const ctx = await esbuild.context(createBuildOptions());
  await ctx.watch();
  logBuildMode("watch");

  const refreshStaticArtifactsDebounced = debounce(() => {
    try {
      refreshStaticArtifacts();
      console.log("[build] artefactos estáticos actualizados");
    } catch (error) {
      console.error("[build] error al refrescar estáticos:", error.message);
    }
  }, 100);

  let staticWatchSignature = getStaticWatchSignature();
  const pollInterval = setInterval(() => {
    const nextSignature = getStaticWatchSignature();
    if (nextSignature === staticWatchSignature) return;

    staticWatchSignature = nextSignature;
    refreshStaticArtifactsDebounced();
  }, 500);

  const stop = async () => {
    await ctx.dispose();
    clearInterval(pollInterval);
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function runBuild() {
  fs.rmSync(DIST, { recursive: true, force: true });
  ensureDir(DIST);
  await esbuild.build(createBuildOptions());
  logBuildMode("build");
}

(async () => {
  try {
    if (IS_WATCH) {
      await runWatch();
      return;
    }

    await runBuild();
  } catch (error) {
    console.error("[build]", error.message || error);
    process.exit(1);
  }
})();
