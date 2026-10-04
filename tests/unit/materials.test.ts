import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { addAttachment } from "../../src/storage/attachments";
import { inspectArchive } from "../../src/storage/backup";
import {
  captureMaterials,
  packMaterials,
  exportMaterials,
  checkMaterialBudget,
} from "../../src/storage/materials";
import { documentMarkdown, fileStem } from "../../src/domain/materials";
import type { JSONContent } from "@tiptap/core";
let db: CityDB;
let service: CityService;
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
beforeEach(async () => {
  db = new CityDB(`materials-${crypto.randomUUID()}`);
  service = new CityService(db);
  await service.initialize("Город", "Свет");
});
afterEach(async () => {
  await db.delete();
});
it("exports exact JSON and only used original image bytes once with safe relative names", async () => {
  const track = (await db.tracks.toArray())[0];
  const attachment = await addAttachment(
    db,
    new File([png], "CON../image.png", { type: "image/png" }),
  );
  await addAttachment(db, new File([png], "unused.png", { type: "image/png" }));
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Кириллица" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ссылка",
            marks: [
              { type: "link", attrs: { href: "https://example.org/a(b)" } },
            ],
          },
          { type: "hardBreak" },
          {
            type: "text",
            text: "<script>alert(1)</script>",
            marks: [
              { type: "bold" },
              { type: "italic" },
              { type: "strike" },
              { type: "underline" },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Цитата" }] },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Пункт" }] },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Третий" }],
              },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "js" },
        content: [{ type: "text", text: "const a = `x`;\n```\nreturn a;" }],
      },
      { type: "horizontalRule" },
      ...[1, 2].map(() => ({
        type: "attachmentImage",
        attrs: { attachmentId: attachment.id, alt: "Два раза" },
      })),
    ],
  };
  for (const title of ["CON", "CON", ".. /сложное: имя\\ < > ?"]) {
    const n = await service.createNote(track.id);
    await service.saveNote({ ...n, title, doc, tags: ["тег"] });
  }
  const before = await db.read();
  const result = await exportMaterials(
    db,
    { objectId: track.id },
    before.storageEpoch,
  );
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const images = Object.keys(files).filter((p) => p.startsWith("images/"));
  expect(images).toHaveLength(1);
  expect(files[images[0]]).toEqual(png);
  expect(
    Object.keys(files).every(
      (p) => !p.includes("..") && !p.includes("\\") && !p.includes(":"),
    ),
  ).toBe(true);
  expect(new Set(Object.keys(files)).size).toBe(8);
  const json = Object.keys(files).filter((p) => p.startsWith("source/"));
  expect(
    json
      .map((p) => JSON.parse(strFromU8(files[p])))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual([...before.notes].sort((a, b) => a.id.localeCompare(b.id)));
  const markdown = strFromU8(
    files[Object.keys(files).find((p) => p.startsWith("notes/"))!],
  );
  expect(markdown).toContain("````js\nconst a = `x`;\n```\nreturn a;\n````");
  expect(markdown).toContain(`../${images[0]}`);
  expect(markdown).toContain("3. Третий");
  expect(markdown).toContain("> Цитата");
  expect(markdown).not.toContain("<script>");
  expect(strFromU8(files["README.md"])).toContain(
    "Пакет материалов для чтения; не архив города для импорта",
  );
  await expect(inspectArchive(result.blob)).rejects.toThrow();
  expect(await db.read()).toEqual(before);
});
it("capture is independent of later edits and epoch replacement cancels delivery", async () => {
  const track = (await db.tracks.toArray())[0];
  const n = await service.createNote(track.id);
  const epoch = (await db.read()).storageEpoch;
  const captured = await captureMaterials(db, { noteId: n.id }, epoch);
  await service.saveNote({ ...n, title: "Изменён позже" });
  const packed = await packMaterials(captured);
  const files = unzipSync(new Uint8Array(await packed.blob.arrayBuffer()));
  expect(
    JSON.parse(
      strFromU8(
        files[Object.keys(files).find((p) => p.startsWith("source/"))!],
      ),
    ).title,
  ).toBe(n.title);
  await db.metadata.put({ id: "epoch", value: "other-city" });
  await expect(exportMaterials(db, { noteId: n.id }, epoch)).rejects.toThrow(
    "Город заменён",
  );
});
it("empty research exports an honest index and missing images abort without mutation", async () => {
  const track = (await db.tracks.toArray())[0];
  const epoch = (await db.read()).storageEpoch;
  const empty = await exportMaterials(db, { objectId: track.id }, epoch);
  expect(
    Object.keys(unzipSync(new Uint8Array(await empty.blob.arrayBuffer()))),
  ).toEqual(["README.md"]);
  const n = await service.createNote(track.id);
  await db.notes.put({
    ...n,
    doc: {
      type: "doc",
      content: [
        { type: "attachmentImage", attrs: { attachmentId: "missing" } },
      ],
    },
  });
  await expect(exportMaterials(db, { noteId: n.id }, epoch)).rejects.toThrow(
    "изображение",
  );
  expect(await db.notes.count()).toBe(1);
});
it("unsupported nodes and unsafe links are explicit; names and limits are bounded", () => {
  const converted = documentMarkdown(
    {
      type: "doc",
      content: [
        { type: "mystery", content: [{ type: "text", text: "Сохранить" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Ссылка",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    },
    new Map(),
  );
  expect(converted.warnings.length).toBeGreaterThanOrEqual(2);
  expect(converted.markdown).not.toContain("javascript:");
  expect(fileStem("CON ../" + "а".repeat(250), 1)).toMatch(/^001-/);
  expect(fileStem("CON", 1)).not.toBe(fileStem("CON", 2));
  expect(() =>
    checkMaterialBudget([{ path: "x", size: 64 * 1024 * 1024 }]),
  ).toThrow("64 MiB");
});

it("replacement during Blob packing cancels the final export and never changes notes", async () => {
  const track = (await db.tracks.toArray())[0];
  const image = await addAttachment(
    db,
    new File([png], "pixel.png", { type: "image/png" }),
  );
  const note = await service.createNote(track.id);
  await service.saveNote({
    ...note,
    doc: {
      type: "doc",
      content: [
        {
          type: "attachmentImage",
          attrs: { attachmentId: image.id, alt: "Тест" },
        },
      ],
    },
  });
  const before = await db.read();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = Blob.prototype.arrayBuffer;
  const spy = vi
    .spyOn(Blob.prototype, "arrayBuffer")
    .mockImplementationOnce(async function (this: Blob) {
      entered();
      await gate;
      return original.call(this);
    });
  const exporting = exportMaterials(
    db,
    { noteId: note.id },
    before.storageEpoch,
  );
  const rejection = expect(exporting).rejects.toThrow("Город заменён");
  await waiting;
  await db.metadata.put({ id: "epoch", value: "replacement" });
  release();
  await rejection;
  spy.mockRestore();
  expect(await db.notes.toArray()).toEqual(before.notes);
});
