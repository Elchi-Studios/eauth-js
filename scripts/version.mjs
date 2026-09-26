// Sets the version of every package, and the range each package asks for
// the others with, to the version given: node scripts/version.mjs 1.1.0
// Run npm install afterwards to update the lockfile.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/version.mjs <version>, for example 1.1.0");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const paths = workspaces.map((dir) => join(root, dir, "package.json"));
const names = new Set(paths.map((p) => JSON.parse(readFileSync(p, "utf8")).name));

for (const path of paths) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep)) pkg[field][dep] = `^${version}`;
    }
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name} ${version}`);
}
