import { strToU8, zipSync } from "fflate";
import type { Attachment, LearningObject, Note, Track } from "../domain/model";
import {
  documentMarkdown,
  fileStem,
  markdownText,
  usedImages,
} from "../domain/materials";
import {
  ARCHIVE_LIMIT,
  DATA_LIMIT,
  EXPANDED_LIMIT,
  IMAGE_LIMIT,
} from "./limits";
import { validateImage } from "./attachments";
import type { CityDB } from "./db";
export type MaterialTarget = { noteId: string } | { objectId: string };
interface MaterialCapture {
  epoch: string;
  exportedAt: string;
  track: Track;
  object?: LearningObject;
  notes: Note[];
  attachments: Attachment[];
}
export function checkMaterialBudget(files: { path: string; size: number }[]) {
  if (files.length > 11001)
    throw new Error("Пакет материалов превышает 11 001 файл.");
  let expanded = 0,
    zip = 22;
  for (const file of files) {
    expanded += file.size;
    zip += file.size + 76 + 2 * strToU8(file.path).length;
  }
  if (expanded > EXPANDED_LIMIT)
    throw new Error("Материалы превышают 128 MiB распакованных данных.");
  if (zip > ARCHIVE_LIMIT)
    throw new Error(
      "Пакет материалов превышает 64 MiB. Выгрузите заметки по отдельности.",
    );
  return zip;
}
export async function assertMaterialEpoch(db: CityDB, epoch: string) {
  if ((await db.metadata.get("epoch"))?.value !== epoch)
    throw new Error(
      "Город заменён во время экспорта. Пакет не передан браузеру; повторите экспорт из нового города.",
    );
}
export async function captureMaterials(
  db: CityDB,
  target: MaterialTarget,
  epoch: string,
): Promise<MaterialCapture> {
  return db.transaction(
    "r",
    [db.metadata, db.tracks, db.learningObjects, db.notes, db.attachments],
    async () => {
      await assertMaterialEpoch(db, epoch);
      const note =
        "noteId" in target ? await db.notes.get(target.noteId) : undefined;
      if ("noteId" in target && !note) throw new Error("Материал не найден.");
      const objectId =
        "objectId" in target ? target.objectId : note?.learningObjectId;
      const object = objectId
        ? await db.learningObjects.get(objectId)
        : undefined;
      const trackId = note?.trackId ?? object?.trackId;
      const track = trackId ? await db.tracks.get(trackId) : undefined;
      if (!track || (objectId && (!object || object.trackId !== track.id)))
        throw new Error("Владелец материалов недоступен.");
      const notes = note
        ? [note]
        : await db.notes.where("learningObjectId").equals(objectId!).toArray();
      if (notes.length > 5000 || notes.some((n) => n.trackId !== track.id))
        throw new Error("Нарушены связи или предел 5000 заметок.");
      const ids = new Set(notes.flatMap((n) => [...usedImages(n.doc)]));
      if (ids.size > 1000)
        throw new Error("Пакет содержит больше 1000 изображений.");
      const found = await db.attachments.bulkGet([...ids].sort());
      const attachments: Attachment[] = [];
      for (const item of found) {
        if (!item)
          throw new Error(
            "Не найдено используемое изображение. Пакет не создан.",
          );
        if (item.size !== item.blob.size || item.size > IMAGE_LIMIT)
          throw new Error(
            "Размер изображения не соответствует данным или превышает 5 MiB.",
          );
        attachments.push(item);
      }
      checkMaterialBudget(
        attachments.map((a, i) => ({ path: `images/${i}.png`, size: a.size })),
      );
      return {
        epoch,
        exportedAt: new Date().toISOString(),
        track,
        object,
        notes: notes.sort((a, b) => a.id.localeCompare(b.id)),
        attachments,
      };
    },
  );
}
export async function packMaterials(captured: MaterialCapture) {
  const files: Record<string, Uint8Array> = {};
  const paths = new Map<string, string>();
  const warnings = new Set<string>();
  for (const [i, a] of captured.attachments.entries()) {
    const extension = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      } as Record<string, string>
    )[a.mime];
    if (!extension) throw new Error("Неподдерживаемый формат изображения.");
    paths.set(
      a.id,
      `images/${String(i + 1).padStart(3, "0")}-image.${extension}`,
    );
  }
  const index = [
    "# Материалы Progress City",
    "Пакет материалов для чтения; не архив города для импорта",
    `Направление: ${markdownText(captured.track.name)}${captured.track.archived ? " (архив)" : ""}`,
    `Исследование: ${markdownText(captured.object?.name ?? "Материалы направления")}`,
    `Следующий вопрос: ${markdownText(captured.object?.nextQuestion || "Пока не задан")}`,
    `Выгружено: ${captured.exportedAt}`,
    "Заметки — текущая сохранённая редакция на момент выгрузки. Исходные JSON в source сохраняют структуру, теги и ID; Markdown не заменяет её точно.",
    "## Материалы",
  ];
  let textBytes = 0;
  for (const [i, note] of captured.notes.entries()) {
    const stem = fileStem(note.title, i + 1),
      path = `notes/${stem}.md`;
    const converted = documentMarkdown(note.doc, paths);
    converted.warnings.forEach((w) => warnings.add(`${note.title}: ${w}`));
    files[path] = strToU8(
      `# ${markdownText(note.title)}\n\nТеги: ${note.tags.map(markdownText).join(", ")}\n\n${converted.markdown}`,
    );
    files[`source/${stem}.json`] = strToU8(JSON.stringify(note, null, 2));
    textBytes += files[path].length + files[`source/${stem}.json`].length;
    if (textBytes > DATA_LIMIT)
      throw new Error(
        "Текст и исходные JSON превышают 32 MiB. Выгрузите заметки по отдельности.",
      );
    index.push(`- [${markdownText(note.title)}](${path})`);
    if (i % 100 === 99)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!captured.notes.length)
    index.push("В этом исследовании пока нет материалов.");
  if (warnings.size)
    index.push(
      "## Предупреждения",
      ...[...warnings].map((w) => `- ${markdownText(w)}`),
    );
  files["README.md"] = strToU8(index.join("\n\n") + "\n");
  if (textBytes + files["README.md"].length > DATA_LIMIT)
    throw new Error("Текст пакета превышает 32 MiB.");
  const projected = checkMaterialBudget([
    ...Object.entries(files).map(([path, bytes]) => ({
      path,
      size: bytes.length,
    })),
    ...captured.attachments.map((a) => ({
      path: paths.get(a.id)!,
      size: a.size,
    })),
  ]);
  // Blob reads/validation happen outside the consistent readonly capture.
  for (const a of captured.attachments) {
    await validateImage(a.blob, a.mime);
    files[paths.get(a.id)!] = new Uint8Array(await a.blob.arrayBuffer());
  }
  const zip = zipSync(files, { level: 0 });
  if (zip.length !== projected || zip.length > ARCHIVE_LIMIT)
    throw new Error("Размер пакета не совпадает с безопасным расчётом.");
  return {
    blob: new Blob([new Uint8Array(zip)], { type: "application/zip" }),
    warnings: [...warnings],
  };
}
export async function exportMaterials(
  db: CityDB,
  target: MaterialTarget,
  epoch: string,
) {
  const result = await packMaterials(await captureMaterials(db, target, epoch));
  await assertMaterialEpoch(db, epoch);
  return result;
}
