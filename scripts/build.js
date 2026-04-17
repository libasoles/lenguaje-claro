#!/usr/bin/env node
// Genera manifest.json leyendo el OAuth client ID desde .env

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function stripTemplateComments(value) {
  if (Array.isArray(value)) {
    return value.map(stripTemplateComments);
  }

  if (value && typeof value === "object") {
    const result = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (key.startsWith("_comment")) {
        return;
      }
      result[key] = stripTemplateComments(nestedValue);
    });
    return result;
  }

  return value;
}

// Cargar .env
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  console.error("Error: no se encontró el archivo .env.");
  console.error(
    "Copia .env.example a .env y establece CHROME_OAUTH_CLIENT_ID."
  );
  process.exit(1);
}

const envVars = {};
fs.readFileSync(envPath, "utf8")
  .split("\n")
  .forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        envVars[key] = value;
      }
    }
  });

const clientId = envVars["CHROME_OAUTH_CLIENT_ID"];
if (!clientId) {
  console.error("Error: define CHROME_OAUTH_CLIENT_ID en .env.");
  process.exit(1);
}

// Leer template
const templatePath = path.join(ROOT, "manifest.template.json");
const template = fs.readFileSync(templatePath, "utf8");

// Reemplazar placeholder
const manifestWithClientId = template.replace(
  "__CHROME_OAUTH_CLIENT_ID__",
  clientId
);
const manifestObject = stripTemplateComments(JSON.parse(manifestWithClientId));
const manifest = JSON.stringify(manifestObject, null, 2) + "\n";

// Escribir manifest.json
const manifestPath = path.join(ROOT, "manifest.json");
fs.writeFileSync(manifestPath, manifest, "utf8");

console.log("manifest.json generado correctamente.");
