import { optionalModule } from "./optional-module";
export const loadBackup = () =>
  optionalModule("src/storage/backup.ts", () => import("../storage/backup"));
