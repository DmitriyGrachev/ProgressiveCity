import { getSchema, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { safeUrl } from "../domain/rules";
export const starterKit = StarterKit.configure({
  link: {
    openOnClick: false,
    autolink: false,
    isAllowedUri: (url) => safeUrl(url),
    HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
  },
});
export const AttachmentImageSpec = Node.create({
  name: "attachmentImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { attachmentId: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return [
      "span",
      { "data-attachment": node.attrs.attachmentId },
      node.attrs.alt || "Изображение",
    ];
  },
});
export const noteSchema = getSchema([starterKit, AttachmentImageSpec]);
