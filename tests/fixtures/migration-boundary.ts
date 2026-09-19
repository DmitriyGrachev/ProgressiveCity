import { strToU8 } from "fflate";
import { legacyCity } from "./legacy-city";
import { migrateV1 } from "../../src/storage/migrate";
import { dataSchema } from "../../src/storage/validation";
import { dataSchema as legacySchema } from "../../src/storage/legacy-validation";

export function migrationBoundary(targetBytes: number, version: 1 | 2 = 2) {
  const data = legacyCity();
  const base = data.notes[0];
  data.notes = Array.from({ length: 84 }, (_, i) => ({
    ...base,
    id: i === 0 ? base.id : `boundary-${i}`,
    text: "я",
    doc: {
      ...base.doc,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "я" }] },
        base.doc.content[1],
      ],
    },
  }));
  const measure = () =>
    strToU8(
      JSON.stringify(
        version === 1
          ? legacySchema.parse(data)
          : dataSchema.parse(migrateV1(legacySchema.parse(data))),
      ),
    ).length;
  let remaining = targetBytes - measure();
  for (const note of data.notes) {
    const count = Math.min(99_999, Math.floor(remaining / 4));
    note.text += "я".repeat(count);
    note.doc.content[0] = {
      type: "paragraph",
      content: [{ type: "text", text: note.text }],
    };
    remaining -= count * 4;
  }
  if (remaining > 3 || remaining < 0)
    throw new Error("Boundary fixture cannot fit target");
  data.notes[0].title += "x".repeat(remaining);
  if (measure() !== targetBytes)
    throw new Error("Boundary fixture size mismatch");
  return legacySchema.parse(data);
}
