import { AttachmentImageSpec } from "./schema";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
function ImageView({ node }: NodeViewProps) {
  const [src, setSrc] = useState("");
  const epoch = useLiveQuery(() => db.metadata.get("epoch"));
  useEffect(() => {
    let alive = true;
    let url = "";
    setSrc("");
    void db.attachments
      .get(String(node.attrs.attachmentId))
      .then((a) => {
        if (alive && a) {
          url = URL.createObjectURL(a.blob);
          setSrc(url);
        }
      })
      .catch(() => {
        if (alive) setSrc("");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [node.attrs.attachmentId, epoch?.value]);
  return (
    <NodeViewWrapper className="note-image">
      {src ? (
        <img
          src={src}
          alt={String(node.attrs.alt || "Изображение заметки")}
          draggable={false}
        />
      ) : (
        <span>Изображение загружается…</span>
      )}
    </NodeViewWrapper>
  );
}
export const AttachmentNode = AttachmentImageSpec.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
