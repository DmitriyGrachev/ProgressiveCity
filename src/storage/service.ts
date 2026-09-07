import type {
  Activity,
  Building,
  City,
  District,
  Note,
  Track,
} from "../domain/model";
import { id, now } from "../domain/model";
import {
  canPlace,
  checkRules,
  localDate,
  rewardFor,
  validDate,
} from "../domain/rules";
import { CityDB, db } from "./db";
import { dataSchema, validateDocument } from "./validation";
import { noteSchema } from "../notes/schema";

type TrackInput = Pick<
  Track,
  | "name"
  | "type"
  | "description"
  | "goal"
  | "schedule"
  | "unit"
  | "comparison"
  | "limit"
>;
type ActivityInput = Omit<
  Activity,
  "id" | "timezone" | "confirmed" | "archived" | "createdAt"
> &
  Partial<Pick<Activity, "id" | "archived">>;
export class CityService {
  constructor(public db: CityDB) {}
  private transaction<T>(fn: () => Promise<T>) {
    return this.db.transaction("rw", this.db.tables, fn);
  }
  private async city() {
    const city = await this.db.cities.get("city");
    if (!city) throw new Error("Сначала создайте город.");
    return city;
  }
  private async track(trackId: string) {
    const t = await this.db.tracks.get(trackId);
    if (!t) throw new Error("Направление не найдено.");
    return t;
  }
  async initialize(name: string, trackName: string) {
    if (!name.trim() || !trackName.trim())
      throw new Error("Введите название города и направления.");
    return this.transaction(async () => {
      if (await this.db.cities.count()) return;
      await this.db.metadata.put({ id: "epoch", value: id() });
      await this.db.cities.add({
        id: "city",
        name: name.trim().slice(0, 120),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reducedMotion: false,
        rules: { version: 1, rewards: [1, 2, 3], costs: [3, 6] },
        createdAt: now(),
      });
      const track = await this.createTrack({
        name: trackName,
        type: "skill",
        description: "",
        goal: "",
        schedule: "Ежедневно",
        unit: "",
        comparison: "min",
      });
      await this.db.buildings.add({
        id: id(),
        trackId: track.id,
        name: track.name,
        kind: "workshop",
        color: "#bc7153",
        x: 19,
        y: 19,
        w: 2,
        h: 2,
      });
      await this.snapshot("Начало города");
    });
  }
  async createTrack(input: TrackInput) {
    if (!input.name.trim()) throw new Error("Введите название направления.");
    const track: Track = {
      ...input,
      name: input.name.trim().slice(0, 120),
      id: id(),
      balance: 0,
      stage: 1,
      archived: false,
      createdAt: now(),
    };
    dataSchema.shape.tracks.element.parse(track);
    await this.db.tracks.add(track);
    return track;
  }
  async updateTrack(input: Track) {
    if (!input.name.trim()) throw new Error("Название не может быть пустым.");
    return this.transaction(async () => {
      const old = await this.track(input.id);
      dataSchema.shape.tracks.element.parse(input);
      if (old.type !== input.type)
        throw new Error(
          "Тип сохранённого направления закреплён. Создайте другое направление.",
        );
      await this.db.tracks.put({
        ...input,
        balance: old.balance,
        stage: old.stage,
        createdAt: old.createdAt,
      });
    });
  }
  async saveActivity(input: ActivityInput): Promise<Activity> {
    if (!input.title.trim() || !validDate(input.date))
      throw new Error("Введите название и корректную дату.");
    if (
      input.duration !== undefined &&
      (!Number.isFinite(input.duration) ||
        input.duration < 0 ||
        input.duration > 1440)
    )
      throw new Error("Длительность: от 0 до 1440 минут.");
    if (input.value !== undefined && !Number.isFinite(input.value))
      throw new Error("Некорректное значение.");
    return this.transaction(async () => {
      const city = await this.city();
      await this.track(input.trackId);
      const old = input.id ? await this.db.activities.get(input.id) : undefined;
      if (old && (input.trackId !== old.trackId || input.date !== old.date))
        throw new Error(
          "Дата и направление сохранённой записи закреплены. Создайте другую запись.",
        );
      for (const noteId of input.noteIds)
        if ((await this.db.notes.get(noteId))?.trackId !== input.trackId)
          throw new Error("Связанная заметка принадлежит другому направлению.");
      const activity: Activity = {
        ...input,
        id: old?.id ?? id(),
        timezone: old?.timezone ?? city.timezone,
        confirmed: old?.confirmed ?? false,
        archived: input.archived ?? old?.archived ?? false,
        createdAt: old?.createdAt ?? now(),
      };
      dataSchema.shape.activities.element.parse(activity);
      await this.db.activities.put(activity);
      return activity;
    });
  }
  async confirmActivity(activityId: string) {
    return this.transaction(async () => {
      const a = await this.db.activities.get(activityId);
      if (!a) throw new Error("Запись не найдена.");
      if (a.confirmed) return;
      if (!a.result.trim()) throw new Error("Коротко опишите свой результат.");
      const track = await this.track(a.trackId);
      const city = await this.city();
      const habit = track.type === "habit" || track.type === "reduce";
      const eventId = habit
        ? `habit:${track.id}:${a.date}`
        : `activity:${a.id}`;
      if (await this.db.events.get(eventId)) {
        await this.db.activities.update(a.id, { confirmed: true });
        return;
      }
      const amount = habit && !a.achieved ? 0 : rewardFor(city.rules, a.kind);
      await this.db.activities.update(a.id, { confirmed: true });
      await this.db.tracks.update(track.id, {
        balance: track.balance + amount,
      });
      await this.db.events.add({
        id: eventId,
        activityId: a.id,
        trackId: track.id,
        type: "activity",
        amount,
        ruleVersion: city.rules.version,
        description: `${a.title} · ${a.date}${habit ? ` · ${a.timezone}` : ""}`,
        createdAt: now(),
      });
    });
  }
  async upgrade(trackId: string, commandId: string) {
    return this.transaction(async () => {
      const eventId = `upgrade:${commandId}`;
      if (await this.db.events.get(eventId)) return;
      const track = await this.track(trackId);
      const city = await this.city();
      if (track.stage >= 3) throw new Error("Достигнут последний этап.");
      const cost = city.rules.costs[track.stage - 1];
      if (track.balance < cost)
        throw new Error(`Нужно ${cost} очков развития.`);
      await this.db.tracks.update(trackId, {
        balance: track.balance - cost,
        stage: (track.stage + 1) as 2 | 3,
      });
      await this.db.events.add({
        id: eventId,
        trackId,
        type: "upgrade",
        amount: -cost,
        ruleVersion: city.rules.version,
        description: `${track.name}: этап ${track.stage + 1}`,
        createdAt: now(),
      });
      await this.snapshot(`${track.name} · этап ${track.stage + 1}`);
    });
  }
  async updateRules(
    rewards: [number, number, number],
    costs: [number, number],
  ) {
    checkRules(rewards, costs);
    return this.transaction(async () => {
      const city = await this.city();
      await this.db.cities.update("city", {
        rules: { version: city.rules.version + 1, rewards, costs },
      });
    });
  }
  async updateSettings(
    input: Pick<City, "name" | "timezone" | "reducedMotion">,
  ) {
    if (!input.name.trim()) throw new Error("Введите название города.");
    try {
      localDate(input.timezone);
    } catch {
      throw new Error("Неизвестный часовой пояс. Например, Europe/Chisinau.");
    }
    dataSchema.shape.city
      .pick({ name: true, timezone: true, reducedMotion: true })
      .parse(input);
    await this.db.cities.update("city", input);
  }
  private async layout(description: string) {
    await this.db.events.add({
      id: id(),
      type: "layout",
      amount: 0,
      ruleVersion: 0,
      description,
      createdAt: now(),
    });
  }
  async placeBuilding(building: Building) {
    dataSchema.shape.buildings.element.parse(building);
    const progress = ["workshop", "library", "pavilion"].includes(
      building.kind,
    );
    const size = progress || ["park", "plaza"].includes(building.kind) ? 2 : 1;
    if (
      progress !== Boolean(building.trackId) ||
      building.w !== size ||
      building.h !== size
    )
      throw new Error("Неверный размер или направление объекта.");
    return this.transaction(async () => {
      if (!canPlace(building, await this.db.buildings.toArray(), building.id))
        throw new Error("Место занято или находится за пределами карты.");
      if (building.trackId) {
        const t = await this.track(building.trackId);
        if (t.archived)
          throw new Error("Сначала верните направление из архива.");
        const other = await this.db.buildings
          .where("trackId")
          .equals(building.trackId)
          .first();
        if (other && other.id !== building.id)
          throw new Error("У направления уже есть здание.");
      }
      await this.db.buildings.put(building);
      await this.layout(`Размещение: ${building.name}`);
    });
  }
  async removeBuilding(buildingId: string) {
    return this.transaction(async () => {
      const b = await this.db.buildings.get(buildingId);
      if (!b) return;
      await this.db.buildings.delete(buildingId);
      await this.layout(`Снято с карты: ${b.name}`);
    });
  }
  async saveDistrict(district: District) {
    dataSchema.shape.districts.element.parse(district);
    if (!district.name.trim()) throw new Error("Введите имя района.");
    return this.transaction(async () => {
      if (!canPlace(district, await this.db.districts.toArray(), district.id))
        throw new Error("Районы не должны пересекаться или выходить за карту.");
      await this.db.districts.put(district);
      await this.layout(`Район: ${district.name}`);
    });
  }
  async removeDistrict(districtId: string) {
    return this.transaction(async () => {
      await this.db.districts.delete(districtId);
      await this.layout("Удалена зона района; здания сохранены");
    });
  }
  async snapshot(name: string) {
    return this.transaction(async () => {
      const tracks = await this.db.tracks.toArray();
      const buildings = (await this.db.buildings.toArray()).map((b) => ({
        ...b,
        stage: tracks.find((t) => t.id === b.trackId)?.stage ?? (1 as const),
      }));
      const snapshot = {
        id: id(),
        name: name.trim() || "Мой снимок",
        createdAt: now(),
        buildings,
        districts: await this.db.districts.toArray(),
      };
      await this.db.snapshots.add(snapshot);
      return snapshot;
    });
  }
  async createNote(trackId: string): Promise<Note> {
    await this.track(trackId);
    const note: Note = {
      id: id(),
      trackId,
      title: "Без названия",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      text: "",
      tags: [],
      createdAt: now(),
      updatedAt: now(),
      revision: 0,
    };
    await this.db.notes.add(note);
    return note;
  }
  async copyNote(draft: Note, expectedEpoch?: string): Promise<Note> {
    return this.transaction(async () => {
      const copy = await this.createNote(draft.trackId);
      return this.saveNote(
        {
          ...draft,
          id: copy.id,
          revision: 0,
          title: `${draft.title.slice(0, 240)} (копия)`,
        },
        expectedEpoch,
      );
    });
  }
  async saveNote(note: Note, expectedEpoch?: string): Promise<Note> {
    const validation = dataSchema.shape.notes.element.safeParse(note);
    if (!validation.success)
      throw new Error(
        "Заметка не сохранена: проверьте формат и лимиты (заголовок/тег до 250 символов, текст до 200 000, до 100 тегов). Черновик остаётся в редакторе.",
      );
    return this.transaction(async () => {
      if (
        expectedEpoch !== undefined &&
        (await this.db.metadata.get("epoch"))?.value !== expectedEpoch
      )
        throw new Error(
          "Город восстановлен в другой вкладке. Выгрузите локальный черновик с изображениями.",
        );
      const current = await this.db.notes.get(note.id);
      if (!current || current.revision !== note.revision)
        throw new Error(
          "Заметка изменена в другой вкладке. Сохраните свой текст отдельной копией.",
        );
      if (
        !validateDocument(
          note.doc,
          new Set(await this.db.attachments.toCollection().primaryKeys()),
        )
      )
        throw new Error(
          "Изображение отсутствует или документ повреждён. Черновик не потерян.",
        );
      const document = noteSchema.nodeFromJSON(note.doc);
      const updated = {
        ...note,
        trackId: current.trackId,
        createdAt: current.createdAt,
        text: document.textBetween(0, document.content.size, "\n\n", "\n"),
        revision: note.revision + 1,
        updatedAt: now(),
      };
      await this.db.notes.put(updated);
      return updated;
    });
  }
}
export const service = new CityService(db);
