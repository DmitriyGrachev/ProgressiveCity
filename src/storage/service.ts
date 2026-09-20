import type {
  Activity,
  Building,
  City,
  District,
  LearningObject,
  Note,
  Track,
} from "../domain/model";
import { id, isLearning, now } from "../domain/model";
import { createResearch, spendOnObject } from "./learning";
import { checkRules, localDate, rewardFor, validDate } from "../domain/rules";
import { CityDB, db } from "./db";
import { LayoutService } from "./layout";
import { snapshotLayout } from "../domain/comparison";
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
  readonly planning: LayoutService;
  constructor(public db: CityDB) {
    this.planning = new LayoutService(db);
  }
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
  private async objectFor(track: Track, objectId?: string) {
    if (!isLearning(track)) {
      if (objectId) throw new Error("У привычки нет учебных объектов.");
      return undefined;
    }
    const object = await this.db.learningObjects.get(objectId ?? track.id);
    if (!object || object.trackId !== track.id)
      throw new Error("Учебный объект не принадлежит направлению.");
    return object;
  }
  private async checkEpoch(expectedEpoch?: string) {
    if (
      expectedEpoch !== undefined &&
      (await this.db.metadata.get("epoch"))?.value !== expectedEpoch
    )
      throw new Error(
        "Город восстановлен в другой вкладке. Обновите страницу перед изменением прогресса.",
      );
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
        rules: {
          version: 1,
          rewards: [1, 2, 3],
          costs: [3, 6],
          constructionCost: 3,
        },
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
        learningObjectId: track.id,
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
    return this.transaction(async () => {
      await this.db.tracks.add(track);
      if (isLearning(track))
        await this.db.learningObjects.add({
          id: track.id,
          trackId: track.id,
          name: track.name,
          nextQuestion: "",
          stage: 1,
          built: true,
          initial: true,
          createdAt: track.createdAt,
        });
      return track;
    });
  }
  async createLearningObject(
    trackId: string,
    name: string,
    expectedEpoch?: string,
  ) {
    return this.transaction(async () => {
      await this.checkEpoch(expectedEpoch);
      return createResearch(this.db, trackId, name);
    });
  }
  async updateLearningObject(
    input: LearningObject,
    expectedEpoch?: string,
    expectedFields?: Pick<LearningObject, "name" | "nextQuestion">,
  ) {
    return this.transaction(async () => {
      await this.checkEpoch(expectedEpoch);
      const old = await this.db.learningObjects.get(input.id);
      if (!old) throw new Error("Учебный объект не найден.");
      if (
        expectedFields &&
        (old.name !== expectedFields.name ||
          old.nextQuestion !== expectedFields.nextQuestion)
      )
        throw new Error(
          "Исследование изменено в другой вкладке. Скопируйте свой вопрос перед загрузкой актуальных полей.",
        );
      const updated = {
        ...old,
        name: input.name.trim(),
        nextQuestion: input.nextQuestion,
      };
      dataSchema.shape.learningObjects.element.parse(updated);
      await this.db.learningObjects.put(updated);
      return updated;
    });
  }
  async construct(
    objectId: string,
    commandId: string,
    sourceActivityId?: string,
    expectedEpoch?: string,
  ) {
    return this.spendObject(
      objectId,
      "construction",
      commandId,
      sourceActivityId,
      expectedEpoch,
    );
  }
  async upgradeObject(
    objectId: string,
    commandId: string,
    sourceActivityId?: string,
    expectedEpoch?: string,
  ) {
    return this.spendObject(
      objectId,
      "upgrade",
      commandId,
      sourceActivityId,
      expectedEpoch,
    );
  }
  private async spendObject(
    objectId: string,
    kind: "upgrade" | "construction",
    commandId: string,
    sourceActivityId?: string,
    expectedEpoch?: string,
  ) {
    return this.transaction(async () => {
      await this.checkEpoch(expectedEpoch);
      const description = await spendOnObject(
        this.db,
        objectId,
        kind,
        commandId,
        sourceActivityId,
      );
      if (description) await this.snapshot(description);
    });
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
  async saveActivity(
    input: ActivityInput,
    expectedEpoch?: string,
  ): Promise<Activity> {
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
      await this.checkEpoch(expectedEpoch);
      const track = await this.track(input.trackId);
      const object = await this.objectFor(track, input.learningObjectId);
      const old = input.id ? await this.db.activities.get(input.id) : undefined;
      if (
        old &&
        (input.trackId !== old.trackId ||
          input.date !== old.date ||
          object?.id !== old.learningObjectId)
      )
        throw new Error(
          "Дата, направление и учебный объект сохранённой записи закреплены. Создайте другую запись.",
        );
      for (const noteId of input.noteIds) {
        const note = await this.db.notes.get(noteId);
        if (
          !note ||
          note.trackId !== input.trackId ||
          note.learningObjectId !== object?.id
        )
          throw new Error(
            "Связанная заметка принадлежит другому направлению или учебному объекту.",
          );
      }
      const activity: Activity = {
        ...input,
        ...(object ? { learningObjectId: object.id } : {}),
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
  async confirmActivity(activityId: string, expectedEpoch?: string) {
    return this.transaction(async () => {
      await this.checkEpoch(expectedEpoch);
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
        ...(a.learningObjectId ? { learningObjectId: a.learningObjectId } : {}),
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
      const track = await this.track(trackId);
      if (isLearning(track)) return this.upgradeObject(track.id, commandId);
      const eventId = `upgrade:${commandId}`;
      if (await this.db.events.get(eventId)) return;
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
    constructionCost?: number,
  ) {
    checkRules(rewards, costs);
    return this.transaction(async () => {
      const city = await this.city();
      const rules = {
        version: city.rules.version + 1,
        rewards,
        costs,
        constructionCost: constructionCost ?? city.rules.constructionCost,
      };
      dataSchema.shape.city.shape.rules.parse(rules);
      await this.db.cities.update("city", {
        rules,
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
  placeBuilding(building: Building, epoch?: string) {
    return this.planning.placeBuilding(building, epoch);
  }
  removeBuilding(buildingId: string, epoch?: string) {
    return this.planning.removeBuilding(buildingId, epoch);
  }
  saveDistrict(district: District, epoch?: string) {
    return this.planning.saveDistrict(district, epoch);
  }
  removeDistrict(districtId: string, epoch?: string) {
    return this.planning.removeDistrict(districtId, epoch);
  }
  async snapshot(name: string) {
    return this.transaction(async () => {
      const tracks = await this.db.tracks.toArray();
      const objects = await this.db.learningObjects.toArray();
      const snapshot = snapshotLayout(
        {
          tracks,
          learningObjects: objects,
          buildings: await this.db.buildings.toArray(),
          districts: await this.db.districts.toArray(),
        },
        id(),
        name.trim() || "Мой снимок",
        now(),
      );
      await this.db.snapshots.add(snapshot);
      return snapshot;
    });
  }
  async createNote(trackId: string, learningObjectId?: string): Promise<Note> {
    return this.transaction(async () => {
      const object = await this.objectFor(
        await this.track(trackId),
        learningObjectId,
      );
      const note: Note = {
        id: id(),
        trackId,
        ...(object ? { learningObjectId: object.id } : {}),
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
    });
  }
  async copyNote(draft: Note, expectedEpoch?: string): Promise<Note> {
    return this.transaction(async () => {
      const copy = await this.createNote(draft.trackId, draft.learningObjectId);
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
        learningObjectId: current.learningObjectId,
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
