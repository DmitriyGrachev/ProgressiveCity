import type { BuildingKind } from "../domain/model";

export interface ArtVariant {
  kind: BuildingKind;
  color: string;
  stage: number;
}
export type PreviewRenderer = (variant: ArtVariant) => Promise<string>;
let renderer: PreviewRenderer | null = null;
const listeners = new Set<() => void>();
const images = new Map<string, Promise<string>>();
export const getPreviewRenderer = () => renderer;
export function subscribePreviews(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The existing city's renderer supplies thumbnails; no second WebGL context. */
export function registerPreviewRenderer(next: PreviewRenderer) {
  renderer = next;
  listeners.forEach((listener) => listener());
  return () => {
    if (renderer === next) {
      renderer = null;
      listeners.forEach((listener) => listener());
    }
  };
}
export function previewImage(variant: ArtVariant, render: PreviewRenderer) {
  const key = `${variant.kind}:${variant.color.toLowerCase()}:${variant.stage}`;
  const cached = images.get(key);
  if (cached) {
    images.delete(key);
    images.set(key, cached);
    return cached;
  }
  const result = render(variant).catch((error: unknown) => {
    if (images.get(key) === result) images.delete(key);
    throw error;
  });
  images.set(key, result);
  if (images.size > 96) images.delete(images.keys().next().value!);
  return result;
}
