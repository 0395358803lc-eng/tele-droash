import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const packagingDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(packagingDir, "../..");
const source = path.resolve(packagingDir, "src/main.ts");
const distDir = path.resolve(packagingDir, "dist");

const workspaceAliasPlugin = {
  name: "workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
      path: path.join(projectRoot, "lib/db/src/index.ts"),
    }));
    build.onResolve({ filter: /^@workspace\/db\/schema$/ }, () => ({
      path: path.join(projectRoot, "lib/db/src/schema/index.ts"),
    }));
    build.onResolve({ filter: /^@workspace\/api-zod$/ }, () => ({
      path: path.join(projectRoot, "lib/api-zod/src/index.ts"),
    }));
  },
};

await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [source],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  entryNames: "[name]",
  target: "node24",
  external: ["electron", "better-sqlite3"],
  sourcemap: "linked",
  logLevel: "info",
  plugins: [
    workspaceAliasPlugin,
    esbuildPluginPino({ transports: ["pino-pretty"] }),
  ],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
  },
});
