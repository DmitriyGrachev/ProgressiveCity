import type { JSONContent } from "@tiptap/core";
import { safeUrl } from "./rules";
export function fileStem(title: string, index: number) {
  const safe =
    Array.from(
      title
        .normalize("NFC")
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/^-+|-+$/g, ""),
    )
      .slice(0, 40)
      .join("") || "material";
  return `${String(index).padStart(3, "0")}-${safe}`;
}
export const markdownText = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, "\\$&");
function fence(text: string, minimum: number) {
  return "`".repeat(
    Math.max(minimum, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
}
export function usedImages(doc: JSONContent) {
  const ids = new Set<string>();
  let count = 0;
  function walk(node: JSONContent, depth: number) {
    if (++count > 20000 || depth > 30)
      throw new Error(
        "Документ превышает предел обхода (20 000 узлов, глубина 30).",
      );
    if (node.type === "attachmentImage")
      ids.add(String(node.attrs?.attachmentId ?? ""));
    node.content?.forEach((child) => walk(child, depth + 1));
  }
  walk(doc, 0);
  return ids;
}
export function documentMarkdown(
  doc: JSONContent,
  imagePaths: Map<string, string>,
) {
  const warnings = new Set<string>();
  let count = 0;
  function render(node: JSONContent, depth = 0): string {
    if (++count > 20000 || depth > 30)
      throw new Error("Документ превышает предел преобразования.");
    const children = () =>
      (node.content ?? []).map((child) => render(child, depth + 1));
    if (node.type === "text") {
      let text = markdownText(node.text ?? "");
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `*${text}*`;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "code") {
          const raw = node.text ?? "",
            wrap = fence(raw, 1);
          text = `${wrap} ${raw} ${wrap}`;
        } else if (mark.type === "link") {
          const href = String(mark.attrs?.href ?? "");
          if (safeUrl(href))
            text = `[${text}](${new URL(href).href.replace(/[()<>\s\\]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)})`;
          else
            warnings.add(
              "Небезопасная ссылка оставлена только в исходном JSON.",
            );
        } else
          warnings.add(
            `Оформление «${mark.type}» сохранено точно в JSON; Markdown показывает текст.`,
          );
      }
      return text;
    }
    switch (node.type) {
      case "doc":
        return children().join("\n\n");
      case "paragraph":
        return children().join("");
      case "heading":
        return `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${children().join("")}`;
      case "hardBreak":
        return "  \n";
      case "horizontalRule":
        return "---";
      case "blockquote":
        return children()
          .join("\n\n")
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
      case "listItem":
        return children().join("\n\n");
      case "bulletList":
      case "orderedList":
        return children()
          .map((text, i) => {
            const prefix =
              node.type === "orderedList"
                ? `${(Number(node.attrs?.start) || 1) + i}. `
                : "- ";
            return (
              prefix + text.replace(/\n/g, "\n" + " ".repeat(prefix.length))
            );
          })
          .join("\n");
      case "codeBlock": {
        const raw = (node.content ?? [])
          .map((child) => child.text ?? "")
          .join("");
        const wrap = fence(raw, 3),
          language = String(node.attrs?.language ?? "")
            .replace(/[^a-zA-Z0-9_+-]/g, "")
            .slice(0, 40);
        return `${wrap}${language}\n${raw}\n${wrap}`;
      }
      case "attachmentImage": {
        const path = imagePaths.get(String(node.attrs?.attachmentId ?? ""));
        if (!path)
          throw new Error(
            "Не найдено используемое изображение. Пакет не создан.",
          );
        return `![${markdownText(String(node.attrs?.alt ?? "Изображение"))}](../${path})`;
      }
      default:
        warnings.add(
          `Узел «${node.type ?? "без типа"}» не поддерживается Markdown; сохранён исходный JSON.`,
        );
        return children().join("\n");
    }
  }
  return { markdown: render(doc) + "\n", warnings: [...warnings] };
}
