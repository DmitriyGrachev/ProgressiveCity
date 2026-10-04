import type { CityData } from "./model";
export interface SearchEntry {
  type: "track" | "object" | "note";
  id: string;
  trackId: string;
  objectId?: string;
  title: string;
  path: string;
  archived: boolean;
  titleKey: string;
  contentKey: string;
}
const normalize = (text: string) => text.trim().toLocaleLowerCase("ru");
export function createSearchIndex(
  data: Pick<CityData, "tracks" | "learningObjects" | "notes">,
): SearchEntry[] {
  const tracks = new Map(data.tracks.map((t) => [t.id, t]));
  const objects = new Map(data.learningObjects.map((o) => [o.id, o]));
  const entries: SearchEntry[] = [];
  for (const track of tracks.values())
    entries.push({
      type: "track",
      id: track.id,
      trackId: track.id,
      title: track.name,
      path: track.name,
      archived: track.archived,
      titleKey: normalize(track.name),
      contentKey: "",
    });
  for (const object of objects.values()) {
    const track = tracks.get(object.trackId);
    if (!track) continue;
    entries.push({
      type: "object",
      id: object.id,
      trackId: track.id,
      objectId: object.id,
      title: object.name,
      path: `${track.name} → ${object.name}`,
      archived: track.archived,
      titleKey: normalize(object.name),
      contentKey: "",
    });
  }
  for (const note of data.notes) {
    const track = tracks.get(note.trackId),
      object = note.learningObjectId
        ? objects.get(note.learningObjectId)
        : undefined;
    if (!track || (note.learningObjectId && object?.trackId !== track.id))
      continue;
    entries.push({
      type: "note",
      id: note.id,
      trackId: track.id,
      objectId: object?.id,
      title: note.title,
      path: [track.name, object?.name, note.title].filter(Boolean).join(" → "),
      archived: track.archived,
      titleKey: normalize(note.title),
      contentKey: normalize(`${note.tags.join(" ")} ${note.text}`),
    });
  }
  return entries;
}
export function searchCity(
  index: SearchEntry[],
  query: string,
  archived: boolean,
  limit = 12,
): SearchEntry[] {
  const q = normalize(query);
  if (!q) return [];
  return index
    .filter((entry) => archived || !entry.archived)
    .map((entry) => ({
      entry,
      rank:
        entry.titleKey === q
          ? 0
          : entry.titleKey.startsWith(q)
            ? 1
            : entry.titleKey.includes(q)
              ? 2
              : entry.contentKey.includes(q)
                ? 3
                : 4,
    }))
    .filter((item) => item.rank < 4)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.entry.path.localeCompare(b.entry.path, "ru") ||
        a.entry.type.localeCompare(b.entry.type) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, limit)
    .map((item) => item.entry);
}
