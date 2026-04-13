#!/usr/bin/env node
// Genera manifest.json leyendo GOOGLE_CLIENT_ID desde .env

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Cargar .env
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  console.error("Error: no se encontró el archivo .env.");
  console.error("Copia .env.example a .env y establece GOOGLE_CLIENT_ID.");
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

const clientId = envVars["GOOGLE_CLIENT_ID"];
if (!clientId) {
  console.error("Error: GOOGLE_CLIENT_ID no está definido en .env.");
  process.exit(1);
}

// Leer template
const templatePath = path.join(ROOT, "manifest.template.json");
const template = fs.readFileSync(templatePath, "utf8");

// Reemplazar placeholder
const manifest = template.replace("__GOOGLE_CLIENT_ID__", clientId);

// Escribir manifest.json
const manifestPath = path.join(ROOT, "manifest.json");
fs.writeFileSync(manifestPath, manifest, "utf8");

console.log("manifest.json generado correctamente.");
