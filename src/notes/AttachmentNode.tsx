import { AttachmentImageSpec } from "./schema";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { createContext, useContext, useEffect, useState } from "react";
import type { Attachment } from "../domain/model";
export const AttachmentCache = createContext<Map<string, Attachment>>(
  new Map(),
);
function ImageView({ node }: NodeViewProps) {
  const [src, setSrc] = useState("");
  const cache = useContext(AttachmentCache);
  useEffect(() => {
    const a = cache.get(String(node.attrs.attachmentId));
    const url = a ? URL.createObjectURL(a.blob) : "";
    setSrc(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [node.attrs.attachmentId, cache]);
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
