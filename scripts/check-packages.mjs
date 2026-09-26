// Checks what npm would publish, package by package, before anything is
// published: the files in each tarball, the metadata, and whether the
// exports and types resolve the way bundlers and Node will resolve them.
// Run after the build; `npm run check` does both.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const workspace = JSON.parse(read("package.json"));
const license = read("LICENSE");
const scope = "@elchi-studios/";
const problems = [];
const tmp = mkdtempSync(join(tmpdir(), "eauth-pack-"));

/** Every file path an exports map points at. */
function targets(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

const manifests = workspace.workspaces.map((dir) => ({ dir, pkg: JSON.parse(read(join(dir, "package.json"))) }));
const version = manifests[0].pkg.version;

try {
  for (const { dir, pkg } of manifests) {
    const fail = (message) => problems.push(`${pkg.name}: ${message}`);

    // Metadata.
    if (!pkg.name.startsWith(scope)) fail(`the name is outside ${scope}`);
    if (pkg.version !== version) fail(`version ${pkg.version}, the others are ${version}; the packages are released together`);
    if (pkg.license !== "MIT") fail("the license is not MIT");
    if (pkg.type !== "module") fail('"type" is not "module"');
    if (pkg.repository?.directory !== dir) fail(`repository.directory is ${pkg.repository?.directory}, expected ${dir}`);
    if (pkg.publishConfig?.access !== "public") fail("publishConfig.access is not public");
    if (pkg.publishConfig?.provenance !== true) fail("publishConfig.provenance is not set");
    if (pkg.sideEffects !== false) fail("sideEffects is not false");
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
      if (dep.startsWith(scope) && range !== `^${version}`) fail(`depends on ${dep}@${range}, expected ^${version}`);
    }
    if (pkg.name === "@elchi-studios/eauth" && Object.keys(pkg.dependencies ?? {}).length > 0) {
      fail("the core has dependencies; its README promises none");
    }
    if (read(join(dir, "LICENSE")) !== license) fail("LICENSE differs from the one at the root");

    // The tarball, exactly as npm would publish it.
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp], join(root, dir)));
    const files = new Set(packed.files.map((f) => f.path));
    for (const required of ["package.json", "README.md", "LICENSE"]) {
      if (!files.has(required)) fail(`${required} is missing from the tarball`);
    }
    for (const target of [...targets(pkg.exports), pkg.main, pkg.types].filter(Boolean)) {
      const path = target.replace(/^\.\//, "");
      if (!files.has(path)) fail(`${target} is referenced but not in the tarball; was the package built?`);
    }
    for (const path of files) {
      if (/^test\//.test(path) || /\.tsbuildinfo$/.test(path) || /(^|\/)\.env/.test(path)) fail(`${path} should not be published`);
    }
    console.log(`${pkg.name}@${pkg.version}: ${packed.entryCount} files, ${(packed.size / 1024).toFixed(1)} kB packed`);

    // Lint the manifest against how tools actually read it.
    try {
      run("npx", ["publint", "--strict", dir]);
    } catch (err) {
      fail(`publint:\n${err.stdout || err.message}`);
    }
    // Resolve the types as TypeScript does under node16 and bundler
    // resolution. The packages are ESM only, which is intended.
    try {
      run("npx", ["attw", join(tmp, packed.filename), "--profile", "esm-only", "--format", "table-flipped"]);
    } catch (err) {
      fail(`types:\n${err.stdout || err.message}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nEvery package is ready to publish.");
