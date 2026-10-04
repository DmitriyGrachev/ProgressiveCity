import type { CityData } from "./model";
export function habitDay(
  data: Pick<CityData, "activities" | "events">,
  trackId: string,
  date: string,
) {
  const event = data.events.find(
    (e) =>
      e.id === `habit:${trackId}:${date}` &&
      e.trackId === trackId &&
      e.type === "activity",
  );
  const activities = data.activities
    .filter((a) => a.trackId === trackId && a.date === date)
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const activity =
    (event && activities.find((a) => a.id === event.activityId)) ||
    activities[0];
  return {
    activity,
    event,
    status: event
      ? event.amount > 0
        ? "reward"
        : "zero"
      : activity
        ? "draft"
        : "none",
  } as const;
}
