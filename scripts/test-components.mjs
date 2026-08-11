#!/usr/bin/env node
/**
 * REGRESSION TEST — NO COMPONENT DEFINED INSIDE ANOTHER COMPONENT
 * ===============================================================
 *     npm run test:components
 *
 * A component declared inside another component is a NEW COMPONENT TYPE on
 * every render. React compares types to decide whether to update a subtree or
 * throw it away, so a fresh type every time means the whole subtree is
 * unmounted and rebuilt on every single state change.
 *
 * It does not error, it does not warn, and it renders correctly. What it does
 * is lose the DOM. On the reset screen that meant every keystroke destroyed the
 * password inputs and built new ones: focus jumped out of the field being typed
 * in, and autoFocus dragged the caret back to the first box. One character per
 * attempt, and no way to type a password at all.
 *
 * The same defect sat in three other screens, invisible only because they have
 * no inputs — but they poll every twenty seconds, so each poll was rebuilding
 * the animated backdrop and restarting its animation.
 *
 * WHY A GREP AND NOT A RENDER
 * ---------------------------
 * Catching this at runtime needs a real renderer, a DOM, and a test that types
 * into a field and asserts where the caret ended up — for a fault whose entire
 * signature is a `const` in the wrong scope. The declaration is the bug, and it
 * is visible in the text. This runs in fifty milliseconds against every file.
 *
 * The rule is absolute on purpose. A nested component is never what someone
 * meant; the fix is always to move it to module scope and pass what it needs as
 * props.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [join(ROOT, "portal"), join(ROOT, "src")];
const SKIP = new Set(["node_modules", ".next", "dist", ".git"]);

function jsxFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsxFiles(p));
    else if (name.endsWith(".jsx")) out.push(p);
  }
  return out;
}

/* Indented, capitalised, an arrow function — and JSX close enough behind it to
   be a component rather than a capitalised constant that happens to be a
   function. Three lines of look-ahead covers `= ({ x }) => (` followed by a
   blank line and a tag. */
const DECL = /^(\s+)const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(\([^)=]*\)|[A-Za-z_$][\w$]*)\s*=>/;
const NESTED_FN = /^(\s+)function\s+([A-Z][A-Za-z0-9_]*)\s*\(/;
const JSX = /<[A-Za-z/>]/;

const findings = [];

for (const root of ROOTS) {
  for (const file of jsxFiles(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = DECL.exec(line) || NESTED_FN.exec(line);
      if (!m) return;
      const looksLikeJsx = lines.slice(i, i + 4).some((l) => JSX.test(l));
      if (!looksLikeJsx) return;
      findings.push({
        file: relative(ROOT, file).replace(/\\/g, "/"),
        line: i + 1,
        name: m[2],
        text: line.trim(),
      });
    });
  }
}

if (findings.length) {
  console.error(`\n${findings.length} component(s) declared inside another component:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.name}`);
    console.error(`      ${f.text}`);
  }
  console.error(
    "\nEach of these is a new component type on every render, so React unmounts\n" +
      "and rebuilds its whole subtree every time the parent's state changes —\n" +
      "which loses focus, loses caret position, and restarts any animation.\n" +
      "\nMove it to module scope and pass what it needs as props.\n"
  );
  process.exit(1);
}

console.log("no component is declared inside another component");
console.log("PASS — typing in a field cannot rebuild the field");
