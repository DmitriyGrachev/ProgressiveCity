import { useState } from "react";
import { db } from "../storage/db";
import { transition, useUI } from "../app/ui";
import type { MaterialTarget } from "../storage/materials";
import { downloadFile } from "../app/download";
import { optionalModule } from "../app/optional-module";
export function MaterialExport({
  target,
  epoch,
}: {
  target: MaterialTarget;
  epoch: string;
}) {
  const [message, setMessage] = useState("");
  const disabled = useUI(
    (s) => s.transitioning || Boolean(s.snapshotId || s.comparison),
  );
  return (
    <div className="material-export">
      <button
        disabled={disabled}
        onClick={() => {
          setMessage("");
          void transition(async () => {
            const { exportMaterials, assertMaterialEpoch } =
              await optionalModule(
                "src/storage/materials.ts",
                () => import("../storage/materials"),
              );
            const result = await exportMaterials(db, target, epoch);
            await assertMaterialEpoch(db, epoch);
            downloadFile(
              result.blob,
              `materials-${new Date().toISOString().slice(0, 10)}.materials.zip`,
            );
            setMessage(
              `Пакет материалов передан браузеру. Проверьте загрузки и сохраните файл.${result.warnings.length ? ` Предупреждения (${result.warnings.length}): ${result.warnings.join(" ")}` : ""}`,
            );
          });
        }}
      >
        {"noteId" in target
          ? "Выгрузить заметку"
          : "Выгрузить материалы исследования"}
      </button>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
