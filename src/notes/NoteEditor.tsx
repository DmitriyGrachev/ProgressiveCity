import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { starterKit } from "./schema";
import type { Note } from "../domain/model";
import { safeUrl } from "../domain/rules";
import { db } from "../storage/db";
import { service } from "../storage/service";
import { addAttachment } from "../storage/attachments";
import { act, navigate, registerEditor, reportError, useUI } from "../app/ui";
import { SaveSession, type SaveStatus } from "./save-session";
import { AttachmentNode } from "./AttachmentNode";

export function NoteEditor({ note, epoch }: { note: Note; epoch: string }) {
  const [status, setStatus] = useState<SaveStatus>("Сохранено");
  const [session] = useState(
    () => new SaveSession(note, (n) => service.saveNote(n, epoch), setStatus),
  );
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState(note.tags.join(", "));
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const pendingUpload = useRef<Promise<void> | null>(null);
  const readonly = useUI((s) => Boolean(s.snapshotId));
  const transitioning = useUI((s) => s.transitioning);
  const editor = useEditor({
    extensions: [starterKit, AttachmentNode],
    content: session.draft.doc,
    editable: !readonly && !transitioning,
    enableContentCheck: true,
    editorProps: {
      attributes: { "aria-label": "Текст заметки", spellcheck: "true" },
    },
    onUpdate: ({ editor }) =>
      session.update({ doc: editor.getJSON(), text: editor.getText() }),
  });
  useEffect(() => {
    const unregister = registerEditor(async () => {
      await pendingUpload.current;
      await session.flush();
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (session.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const onVisibility = () => {
      if (document.visibilityState === "hidden")
        void session.flush().catch(reportError);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unregister();
      session.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);
  useEffect(() => {
    editor?.setEditable(!readonly && !transitioning, false);
  }, [editor, readonly, transitioning]);
  async function upload(file?: File) {
    if (!file || !editor) return;
    setUploading(true);
    try {
      const a = await addAttachment(db, file);
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "attachmentImage",
            attrs: { attachmentId: a.id, alt: file.name },
          },
          { type: "paragraph" },
        ])
        .focus("end")
        .run();
      await session.flush();
    } catch (e) {
      reportError(e);
    } finally {
      setUploading(false);
    }
  }
  return (
    <section className="note-editor">
      <div className="row spread">
        <span className="eyebrow">Материал</span>
        <span
          className={status.startsWith("Ошибка") ? "save-error" : "muted"}
          data-testid="save-status"
          role="status"
        >
          {status}
        </span>
      </div>
      <label>
        Заголовок заметки
        <input
          disabled={readonly || transitioning}
          value={title}
          maxLength={250}
          onChange={(e) => {
            setTitle(e.target.value);
            session.update({ title: e.target.value });
          }}
        />
      </label>
      {!readonly && (
        <>
          <div className="editor-toolbar" aria-label="Форматирование">
            <button
              aria-label="Жирный"
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <b>Ж</b>
            </button>
            <button
              aria-label="Курсив"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <i>К</i>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              Список
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            >
              Код
            </button>
            <button
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              Заголовок
            </button>
            <label className="upload-button">
              {uploading ? "Загрузка…" : "Изображение"}
              <input
                aria-label="Добавить изображение"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  pendingUpload.current = upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="row">
            <input
              aria-label="Адрес ссылки"
              placeholder="https://… — ссылка для выделенного текста"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              onClick={() => {
                if (!safeUrl(link)) {
                  reportError(
                    new Error("Разрешены ссылки http, https и mailto."),
                  );
                  return;
                }
                editor?.chain().focus().setLink({ href: link }).run();
                setLink("");
              }}
            >
              Ссылка
            </button>
          </div>
        </>
      )}
      <EditorContent editor={editor} />
      <label>
        Теги через запятую
        <input
          disabled={readonly || transitioning}
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            session.update({
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 100),
            });
          }}
        />
      </label>
      {!readonly && (
        <>
          <div className="row wrap">
            <button
              className="primary"
              disabled={uploading}
              onClick={() => void act(() => session.flush())}
            >
              Сохранить заметку
            </button>
            <button
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .insertContent(
                    "<h2>Вопрос</h2><p></p><h2>Эксперимент</h2><p></p><h2>Вывод</h2><p></p><h2>Что проверить</h2><p></p>",
                  )
                  .run();
              }}
            >
              Добавить шаблон
            </button>
          </div>
          {status.startsWith("Ошибка") && (
            <button
              onClick={() =>
                void act(async () => {
                  const saved = await service.copyNote(session.draft);
                  session.acceptSavedCopy(saved);
                  await navigate({ noteId: saved.id });
                })
              }
            >
              Сохранить отдельную копию
            </button>
          )}
        </>
      )}
      <p className="hint">
        Автосохранение. Изображения PNG/JPEG/WebP до 5 MiB. Код хранится как
        текст.
      </p>
    </section>
  );
}
