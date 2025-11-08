import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const config = JSON.parse(readFileSync(resolve(ROOT, "extension.config.json"), "utf-8"));

if (!config.name) throw new Error("extension.config.json: 'name' is required");
if (!config.appOrigin) throw new Error("extension.config.json: 'appOrigin' is required");
if (!config.appOrigin.startsWith("https://")) {
  throw new Error("extension.config.json: 'appOrigin' must start with https://");
}

const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const channel = config.channel || `${slug}-ext-bridge`;
const portName = config.portName || `${slug}-bridge`;
const version = config.version || "0.0.1";
const description = config.description || `${config.name} Slack bridge extension.`;
const appOrigin = config.appOrigin.replace(/\/+$/, "");

// Clean and create dist/
const dist = resolve(ROOT, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Copy static assets
cpSync(resolve(ROOT, "public/assets"), resolve(dist, "assets"), { recursive: true });

// Generate manifest from template
let manifest = readFileSync(resolve(ROOT, "public/manifest.template.json"), "utf-8");
manifest = manifest.replaceAll("__NAME__", config.name);
manifest = manifest.replaceAll("__DESCRIPTION__", description);
manifest = manifest.replaceAll("__VERSION__", version);
manifest = manifest.replaceAll("__APP_ORIGIN__", appOrigin);
JSON.parse(manifest); // validate
writeFileSync(resolve(dist, "manifest.json"), manifest);

// Compile TypeScript
execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "inherit" });

// Replace sentinels in compiled JS
const sentinels = {
  "%%CHANNEL%%": channel,
  "%%PORT_NAME%%": portName,
  "%%APP_ORIGIN%%": appOrigin,
};

for (const file of ["background.js", "bridge.js"]) {
  const path = resolve(dist, file);
  let content = readFileSync(path, "utf-8");
  for (const [sentinel, value] of Object.entries(sentinels)) {
    content = content.replaceAll(sentinel, value);
  }
  if (content.includes("%%")) {
    throw new Error(`Unreplaced sentinel found in ${file}`);
  }
  writeFileSync(path, content);
}

console.log(`Built extension: ${config.name} v${version}`);
console.log(`  App origin: ${appOrigin}`);
console.log(`  Channel: ${channel}`);
console.log(`  Output: dist/`);
