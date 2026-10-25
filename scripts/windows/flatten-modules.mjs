// Turns the pnpm-style node_modules of a Next.js standalone build (links into node_modules/.pnpm)
// into a flat one made of plain folders, like npm's, so it survives being copied by an installer
// (which cannot keep links) and Node still finds every package's dependencies.
//
//   node flatten-modules.mjs <standalone node_modules> <output node_modules>
//
// Every package goes to the top level. When two versions of one package exist, the one most
// packages use goes to the top and the other is nested inside each package that needs it
// (<package>/node_modules/<dependency>), as npm does.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error("Usage: node flatten-modules.mjs <standalone node_modules> <output node_modules>");
  process.exit(2);
}
const store = join(source, ".pnpm");

/** Names inside a node_modules folder, scoped ones as "@scope/name". */
function entries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) =>
    name.startsWith("@")
      ? readdirSync(join(dir, name)).map((sub) => `${name}/${sub}`)
      : name === ".bin" || name === ".pnpm" || name.startsWith(".")
        ? []
        : [name],
  );
}

// Each store entry: the real package folder and the dependencies linked beside it.
const packages = new Map(); // real folder -> { name, real, deps: Map(name -> real folder) }
for (const entry of readdirSync(store)) {
  const nm = join(store, entry, "node_modules");
  if (entry === "node_modules" || !existsSync(nm)) continue;
  const all = entries(nm);
  const own = all.find((name) => !lstatSync(join(nm, name)).isSymbolicLink());
  if (!own) continue;
  const real = realpathSync(join(nm, own));
  const deps = new Map();
  for (const name of all) if (name !== own) deps.set(name, realpathSync(join(nm, name)));
  packages.set(real, { name: own, real, deps });
}

// Top level: for each name, the version most packages depend on (the app's own links count too).
const votes = new Map(); // name -> Map(real -> count)
const vote = (name, real) => {
  const v = votes.get(name) ?? new Map();
  v.set(real, (v.get(real) ?? 0) + 1);
  votes.set(name, v);
};
for (const p of packages.values()) {
  vote(p.name, p.real);
  for (const [name, real] of p.deps) vote(name, real);
}
for (const name of entries(source)) vote(name, realpathSync(join(source, name)));
for (const name of entries(source)) votes.get(name).set(realpathSync(join(source, name)), Infinity);
const top = new Map(); // name -> real
for (const [name, v] of votes) top.set(name, [...v].sort((a, b) => b[1] - a[1])[0][0]);

const copy = (from, to) => {
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true });
};
mkdirSync(target, { recursive: true });
for (const [name, real] of top) copy(real, join(target, name));

// Other versions: nested inside each top-level package that needs them.
let nested = 0;
for (const [name, real] of top) {
  const p = packages.get(real);
  if (!p) continue;
  for (const [dep, depReal] of p.deps) {
    if (top.get(dep) === depReal) continue;
    copy(depReal, join(target, name, "node_modules", dep));
    nested++;
  }
}
console.log(
  `${top.size} packages flattened${nested ? `, ${nested} nested for other versions` : ""}.`,
);
