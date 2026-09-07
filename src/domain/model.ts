import type { JSONContent } from "@tiptap/core";

export type TrackType = "skill" | "project" | "habit" | "reduce";
export type ResultKind = "explore" | "verify" | "apply";
export type BuildingKind =
  "workshop" | "library" | "pavilion" | "road" | "park" | "plaza" | "tree";
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Rules {
  version: number;
  rewards: [number, number, number];
  costs: [number, number];
}
export interface City {
  id: "city";
  name: string;
  timezone: string;
  reducedMotion: boolean;
  rules: Rules;
  createdAt: string;
}
export interface Track {
  id: string;
  name: string;
  type: TrackType;
  description: string;
  goal: string;
  schedule: string;
  unit: string;
  limit?: number;
  comparison: "min" | "max";
  archived: boolean;
  balance: number;
  stage: 1 | 2 | 3;
  createdAt: string;
}
export interface Building extends Rect {
  id: string;
  trackId?: string;
  kind: BuildingKind;
  name: string;
  color: string;
}
export interface District extends Rect {
  id: string;
  name: string;
  color: string;
}
export interface Note {
  id: string;
  trackId: string;
  title: string;
  doc: JSONContent;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface Attachment {
  id: string;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
}
export interface Activity {
  id: string;
  trackId: string;
  title: string;
  result: string;
  kind: ResultKind;
  date: string;
  timezone: string;
  noteIds: string[];
  duration?: number;
  value?: number;
  achieved: boolean;
  confirmed: boolean;
  archived: boolean;
  createdAt: string;
}
export interface ProgressEvent {
  id: string;
  type: "activity" | "upgrade" | "layout";
  trackId?: string;
  activityId?: string;
  amount: number;
  ruleVersion: number;
  description: string;
  createdAt: string;
}
export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  buildings: (Building & { stage: 1 | 2 | 3 })[];
  districts: District[];
}
export interface CityData {
  city?: City;
  storageEpoch: string;
  tracks: Track[];
  buildings: Building[];
  districts: District[];
  notes: Note[];
  activities: Activity[];
  events: ProgressEvent[];
  snapshots: Snapshot[];
}
export const labels = {
  tracks: {
    skill: "Навык",
    project: "Проект",
    habit: "Привычка",
    reduce: "Сокращение привычки",
  },
  buildings: {
    workshop: "Мастерская",
    library: "Библиотека",
    pavilion: "Павильон",
    road: "Дорога",
    park: "Парк",
    plaza: "Площадь",
    tree: "Дерево",
  },
  results: {
    explore: "Исследование / попытка",
    verify: "Проверка на примере",
    apply: "Самостоятельное применение",
  },
};
export const palettes = ["#bc7153", "#578b7c", "#647ba3", "#ac8a49", "#90759d"];
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
