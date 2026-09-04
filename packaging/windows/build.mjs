import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const packagingDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(packagingDir, "src/main.ts");
const distDir = path.resolve(packagingDir, "dist");

await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [source],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.join(distDir, "main.mjs"),
  target: "node24",
  external: ["electron", "better-sqlite3"],
  sourcemap: "linked",
  logLevel: "info",
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
  },
});
