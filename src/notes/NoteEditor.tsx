import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { starterKit, noteSchema } from "./schema";
import type { Note } from "../domain/model";
import { safeUrl } from "../domain/rules";
import { db } from "../storage/db";
import { service } from "../storage/service";
import { addAttachment } from "../storage/attachments";
import { act, navigate, registerEditor, reportError, useUI } from "../app/ui";
import { SaveSession, type SaveStatus } from "./save-session";
import { AttachmentNode, AttachmentCache } from "./AttachmentNode";
import { retainDraft, type LocalDraft } from "./recovery";

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
  const pendingCopy = useRef<Promise<void> | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [copying, setCopying] = useState(false);
  const [initialEpoch] = useState(epoch);
  const invalidated = epoch !== initialEpoch;
  const [local] = useState<LocalDraft>(() => ({
    id: crypto.randomUUID(),
    session,
    attachments: new Map(),
    wait: async () => {
      await ready.current;
      await pendingUpload.current;
      await pendingCopy.current?.catch(() => {});
    },
  }));
  const readonly = useUI((s) => Boolean(s.snapshotId));
  const transitioning = useUI((s) => s.transitioning);
  const locked =
    readonly || transitioning || copying || invalidated || !cacheReady;
  const editor = useEditor({
    extensions: [starterKit, AttachmentNode],
    content: session.draft.doc,
    editable: !locked,
    enableContentCheck: true,
    editorProps: {
      attributes: { "aria-label": "Текст заметки", spellcheck: "true" },
    },
    onUpdate: ({ editor }) =>
      session.update({ doc: editor.getJSON(), text: editor.getText() }),
  });
  useEffect(() => {
    let mounted = true;
    ready.current = db.transaction(
      "r",
      [db.metadata, db.attachments],
      async () => {
        if ((await db.metadata.get("epoch"))?.value !== initialEpoch)
          throw new Error(
            "Город изменился при открытии материала. Откройте заметку снова.",
          );
        const ids = new Set<string>();
        noteSchema.nodeFromJSON(session.draft.doc).descendants((node) => {
          if (node.type.name === "attachmentImage")
            ids.add(String(node.attrs.attachmentId));
        });
        const attachments = await db.attachments.bulkGet([...ids]);
        for (const a of attachments) {
          if (!a)
            throw new Error(
              "Изображение отсутствует. Редактирование приостановлено.",
            );
          local.attachments.set(a.id, a);
        }
      },
    );
    void ready.current
      .then(() => {
        if (mounted) setCacheReady(true);
      })
      .catch(reportError);
    return () => {
      mounted = false;
    };
  }, [initialEpoch, local, session]);
  useEffect(() => {
    if (invalidated) {
      session.dispose();
      if (session.dirty || pendingUpload.current) retainDraft(local);
    }
  }, [invalidated, local, session]);
  useEffect(() => {
    const flush = async () => {
      await pendingCopy.current;
      await pendingUpload.current;
      if ((await db.metadata.get("epoch"))?.value !== initialEpoch) {
        if (session.dirty) retainDraft(local);
        return;
      }
      await session.flush();
    };
    const unregister = registerEditor(flush);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (session.dirty || pendingUpload.current || pendingCopy.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const onVisibility = () => {
      if (document.visibilityState === "hidden")
        void flush().catch(reportError);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unregister();
      session.dispose();
      if (session.dirty || pendingUpload.current) retainDraft(local);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session, initialEpoch, local]);
  useEffect(() => {
    editor?.setEditable(!locked, false);
  }, [editor, locked]);
  async function upload(file?: File) {
    if (!file || !editor) return;
    setUploading(true);
    try {
      const a = await addAttachment(db, file, initialEpoch, (a) =>
        local.attachments.set(a.id, a),
      );
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
      if ((await db.metadata.get("epoch"))?.value !== initialEpoch)
        retainDraft(local);
    } finally {
      setUploading(false);
    }
  }
  async function saveCopy() {
    if (pendingCopy.current || locked) return;
    setCopying(true);
    editor?.setEditable(false, false);
    let savedId: string | undefined;
    pendingCopy.current = (async () => {
      await pendingUpload.current;
      await session.settle();
      const draft = session.draft;
      const saved = await service.copyNote(draft, initialEpoch);
      session.acceptSavedCopy(saved, draft);
      await session.flush();
      savedId = saved.id;
    })();
    try {
      await pendingCopy.current;
    } finally {
      pendingCopy.current = null;
      setCopying(false);
    }
    if (savedId) await navigate({ noteId: savedId });
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
      <fieldset disabled={locked}>
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
                    pendingUpload.current = upload(e.target.files?.[0]).finally(
                      () => {
                        pendingUpload.current = null;
                      },
                    );
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
        {cacheReady && (
          <AttachmentCache.Provider value={local.attachments}>
            <EditorContent editor={editor} />
          </AttachmentCache.Provider>
        )}
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
              <button onClick={() => void act(saveCopy)}>
                Сохранить отдельную копию
              </button>
            )}
          </>
        )}
      </fieldset>
      <p className="hint">
        Автосохранение. Изображения PNG/JPEG/WebP до 5 MiB. Код хранится как
        текст. Общий резервный архив ограничен 64 MiB, данные — 32 MiB UTF-8.
        Проверяйте объём в настройках до заполнения; неиспользуемые изображения
        тоже занимают место.
      </p>
    </section>
  );
}
