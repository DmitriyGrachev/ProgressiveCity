import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A failed ESM dependency is cached by the browser. Retrying only the optional
// entry with a new URL is safe when its static dependencies are already loaded.
const manifest = JSON.parse(await readFile("dist/chunks.json", "utf8"));
function dependencies(entry, visited = new Set()) {
  assert.ok(manifest[entry], `Missing build entry: ${entry}`);
  for (const imported of manifest[entry].imports ?? []) {
    if (visited.has(imported)) continue;
    visited.add(imported);
    dependencies(imported, visited);
  }
  return visited;
}
const initial = dependencies("index.html");
initial.add("index.html");
for (const entry of [
  "src/notes/NoteEditor.tsx",
  "src/features/BuildPanel.tsx",
  "src/features/Settings.tsx",
  "src/storage/backup.ts",
  "src/storage/materials.ts",
]) {
  assert.ok(!initial.has(entry), `Optional entry became eager: ${entry}`);
  for (const imported of dependencies(entry)) {
    assert.ok(
      initial.has(imported),
      `Retry cannot recover a failed dependency: ${entry} -> ${imported}`,
    );
  }
}
console.log(
  "Optional module graph: 5 entries, all static dependencies loaded initially.",
);
