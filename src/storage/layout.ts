import {
  id,
  isLearning,
  now,
  type Building,
  type District,
} from "../domain/model";
import { roadCellState, type Cell } from "../domain/roads";
import { canPlace, MAP_SIZE } from "../domain/rules";
import type { CityDB } from "./db";
import { dataSchema } from "./validation";

interface Delta<T> {
  before: T[];
  after: T[];
}
interface Command {
  label: string;
  buildings: Delta<Building>;
  districts: Delta<District>;
}
interface HistoryState {
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
}
function same<T extends object>(a: T | undefined, b: T | undefined) {
  if (!a || !b) return a === b;
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}
const empty = <T>(): Delta<T> => ({ before: [], after: [] });

/** Session-only commands. Persistent geometry and the audit event commit together. */
export class LayoutService {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private epoch?: string;
  private pending = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private state: HistoryState = {
    undoLabel: null,
    redoLabel: null,
    busy: false,
  };
  constructor(private db: CityDB) {}
  getSnapshot = () => this.state;
  async whenIdle() {
    while (this.pending) await this.queue;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.state = {
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      busy: this.pending > 0,
    };
    this.listeners.forEach((listener) => listener());
  }
  syncEpoch(epoch: string) {
    if (this.epoch === epoch) return;
    this.epoch = epoch;
    this.undoStack = [];
    this.redoStack = [];
    this.publish();
  }
  private run(action: () => Promise<void>) {
    this.pending++;
    this.publish();
    const result = this.queue.then(action).finally(() => {
      this.pending--;
      this.publish();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private async checkEpoch(expected?: string) {
    const epoch = (await this.db.metadata.get("epoch"))?.value;
    if (!epoch || !(await this.db.cities.get("city")))
      throw new Error("Сначала создайте город.");
    this.syncEpoch(epoch);
    if (expected !== undefined && expected !== epoch)
      throw new Error(
        "Город восстановлен в другой вкладке. Выберите инструмент заново.",
      );
  }
  private async validateBuilding(
    b: Building,
    all: Building[],
    restoring = false,
  ) {
    dataSchema.shape.buildings.element.parse(b);
    const progress = ["workshop", "library", "pavilion"].includes(b.kind);
    const size = progress || ["park", "plaza"].includes(b.kind) ? 2 : 1;
    if (progress !== Boolean(b.trackId) || b.w !== size || b.h !== size)
      throw new Error("Неверный размер или направление объекта.");
    if (!canPlace(b, all, b.id))
      throw new Error("Место занято или находится за пределами карты.");
    if (!b.trackId) {
      if (b.learningObjectId)
        throw new Error("Декор не может принадлежать учебному объекту.");
      return b;
    }
    const track = await this.db.tracks.get(b.trackId);
    if (!track) throw new Error("Направление не найдено.");
    if (track.archived && !restoring)
      throw new Error("Сначала верните направление из архива.");
    if (isLearning(track)) {
      const object = await this.db.learningObjects.get(
        b.learningObjectId ?? track.id,
      );
      if (!object || object.trackId !== track.id)
        throw new Error("Учебный объект не принадлежит направлению.");
      if (!object.built)
        throw new Error("Сначала оплатите строительство объекта.");
      b = { ...b, learningObjectId: object.id };
    } else if (b.learningObjectId)
      throw new Error("У привычки нет учебных объектов.");
    if (
      all.some(
        (other) =>
          other.id !== b.id &&
          (b.learningObjectId
            ? other.learningObjectId === b.learningObjectId
            : other.trackId === b.trackId),
      )
    )
      throw new Error("У этого объекта уже есть здание.");
    return b;
  }
  private change(make: () => Promise<Command | undefined>, epoch?: string) {
    return this.run(async () => {
      const command = await this.db.transaction(
        "rw",
        this.db.tables,
        async () => {
          await this.checkEpoch(epoch);
          const command = await make();
          if (command) await this.apply(command, false, command.label);
          return command;
        },
      );
      if (command) {
        this.undoStack.push(command);
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.redoStack = [];
      }
    });
  }
  placeBuilding(input: Building, epoch?: string) {
    const draft = { ...input };
    return this.change(async () => {
      const b = await this.validateBuilding(
        draft,
        await this.db.buildings.toArray(),
      );
      const previous = await this.db.buildings.get(b.id);
      if (
        previous &&
        (previous.trackId !== b.trackId ||
          previous.learningObjectId !== b.learningObjectId)
      )
        throw new Error("Связь существующего здания закреплена.");
      if (same(previous, b)) return;
      return {
        label: `${previous ? "Изменение" : "Размещение"}: ${b.name}`,
        buildings: { before: previous ? [previous] : [], after: [b] },
        districts: empty<District>(),
      };
    }, epoch);
  }
  placeRoad(template: Building, input: Cell[], epoch: string) {
    const cells = input.map((c) => ({ ...c }));
    const draft = { ...template };
    return this.change(async () => {
      if (
        draft.kind !== "road" ||
        draft.trackId ||
        draft.learningObjectId ||
        !cells.length ||
        cells.length > (MAP_SIZE + 2) ** 2
      )
        throw new Error("Неверный маршрут дороги.");
      const all = await this.db.buildings.toArray();
      const unique = [
        ...new Map(cells.map((c) => [`${c.x},${c.y}`, c])).values(),
      ];
      if (unique.some((cell) => roadCellState(cell, all) === "blocked"))
        throw new Error(
          "Место занято или находится за пределами карты. Дорога не построена.",
        );
      const additions = unique
        .filter((cell) => roadCellState(cell, all) === "free")
        .map((cell) => ({ ...draft, ...cell, id: id(), w: 1, h: 1 }));
      if (!additions.length) return;
      return {
        label: `Дорога: ${additions.length} клеток`,
        buildings: { before: [], after: additions },
        districts: empty<District>(),
      };
    }, epoch);
  }
  removeBuilding(buildingId: string, epoch?: string) {
    return this.change(async () => {
      const b = await this.db.buildings.get(buildingId);
      if (b)
        return {
          label: `Снятие: ${b.name}`,
          buildings: { before: [b], after: [] },
          districts: empty<District>(),
        };
    }, epoch);
  }
  saveDistrict(input: District, epoch?: string) {
    const d = { ...input };
    return this.change(async () => {
      dataSchema.shape.districts.element.parse(d);
      if (!d.name.trim()) throw new Error("Введите имя района.");
      const previous = await this.db.districts.get(d.id);
      if (same(previous, d)) return;
      return {
        label: `Район: ${d.name}`,
        buildings: empty<Building>(),
        districts: { before: previous ? [previous] : [], after: [d] },
      };
    }, epoch);
  }
  removeDistrict(districtId: string, epoch?: string) {
    return this.change(async () => {
      const d = await this.db.districts.get(districtId);
      if (d)
        return {
          label: `Снятие района: ${d.name}`,
          buildings: empty<Building>(),
          districts: { before: [d], after: [] },
        };
    }, epoch);
  }
  private async apply(command: Command, reverse: boolean, description: string) {
    const delta = <T>(d: Delta<T>) =>
      reverse ? { before: d.after, after: d.before } : d;
    const b = delta(command.buildings),
      d = delta(command.districts);
    // Compare only touched records; unrelated work from other tabs remains intact.
    const prepare = <T extends { id: string }>(delta: Delta<T>, all: T[]) => {
      const ids = new Set([...delta.before, ...delta.after].map((v) => v.id));
      for (const key of ids)
        if (
          !same(
            all.find((v) => v.id === key),
            delta.before.find((v) => v.id === key),
          )
        )
          throw new Error(
            "Объект изменён в другой вкладке. Планировка сохранена без перезаписи.",
          );
      return [...all.filter((v) => !ids.has(v.id)), ...delta.after];
    };
    const buildings = prepare(b, await this.db.buildings.toArray());
    const districts = prepare(d, await this.db.districts.toArray());
    for (const target of b.after)
      await this.validateBuilding(target, buildings, true);
    for (const target of d.after)
      if (!canPlace(target, districts, target.id))
        throw new Error("Районы не должны пересекаться или выходить за карту.");
    await this.db.buildings.bulkDelete(b.before.map((v) => v.id));
    await this.db.buildings.bulkPut(b.after);
    await this.db.districts.bulkDelete(d.before.map((v) => v.id));
    await this.db.districts.bulkPut(d.after);
    await this.db.events.add({
      id: id(),
      type: "layout",
      amount: 0,
      ruleVersion: 0,
      description,
      createdAt: now(),
    });
  }
  private travel(reverse: boolean, epoch: string) {
    return this.run(async () => {
      const command = await this.db.transaction(
        "rw",
        this.db.tables,
        async () => {
          await this.checkEpoch(epoch);
          const source = reverse ? this.undoStack : this.redoStack;
          const command = source.at(-1);
          if (command)
            await this.apply(
              command,
              reverse,
              `${reverse ? "Отмена" : "Повтор"}: ${command.label}`,
            );
          return command;
        },
      );
      if (command && this.epoch === epoch) {
        (reverse ? this.undoStack : this.redoStack).pop();
        (reverse ? this.redoStack : this.undoStack).push(command);
      }
    });
  }
  undo(epoch: string) {
    return this.travel(true, epoch);
  }
  redo(epoch: string) {
    return this.travel(false, epoch);
  }
}
