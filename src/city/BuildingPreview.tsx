import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getPreviewRenderer,
  previewImage,
  subscribePreviews,
  type ArtVariant,
} from "./preview-cache";

export function BuildingPreview({ kind, color, stage }: ArtVariant) {
  const renderer = useSyncExternalStore(subscribePreviews, getPreviewRenderer);
  const key = `${kind}:${color}:${stage}`;
  const [image, setImage] = useState<{ key: string; src: string }>();
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!renderer) return;
    let active = true;
    void previewImage({ kind, color, stage }, renderer).then(
      (src) => {
        if (active) {
          setImage({ key, src });
          setFailure("");
        }
      },
      () => {
        if (active) setFailure(key);
      },
    );
    return () => {
      active = false;
    };
  }, [renderer, key, kind, color, stage]);
  return image?.key === key ? (
    <img
      className="building-thumbnail"
      src={image.src}
      alt=""
      width="320"
      height="340"
    />
  ) : (
    <span className="thumbnail-loading">
      {failure === key ? "Изображение недоступно" : "Рисуем…"}
    </span>
  );
}
