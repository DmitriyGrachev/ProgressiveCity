import { lazyFeature } from "../app/lazy-feature";
import { optionalModule } from "../app/optional-module";
export const NoteEditor = lazyFeature(
  async () => ({
    default: (
      await optionalModule(
        "src/notes/NoteEditor.tsx",
        () => import("./NoteEditor"),
      )
    ).NoteEditor,
  }),
  "редактора",
);
