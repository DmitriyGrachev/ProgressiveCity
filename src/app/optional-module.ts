interface Chunk {
  file: string;
}
let manifest: Promise<Record<string, Chunk>> | undefined;
const attempts = new Map<string, number>();
/** Failed ESM fetches are cached by the browser. Retry the emitted entry with a fresh URL. */
export async function optionalModule<T>(
  source: string,
  initial: () => Promise<T>,
): Promise<T> {
  const attempt = attempts.get(source) ?? 0;
  try {
    if (attempt === 0) return await initial();
    let path = `/${source}`;
    if (!import.meta.env.DEV) {
      manifest ??= fetch("/chunks.json")
        .then(async (response) => {
          if (!response.ok) throw new Error("Описание сборки недоступно.");
          return (await response.json()) as Record<string, Chunk>;
        })
        .catch((error) => {
          manifest = undefined;
          throw error;
        });
      const file = (await manifest)[source]?.file;
      if (!file || !/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(file))
        throw new Error(
          "Модуль отсутствует в подготовленной сборке. Выполните Prepare после сохранения работы и Stop.",
        );
      path = `/${file}`;
    }
    return (await import(/* @vite-ignore */ `${path}?retry=${attempt}`)) as T;
  } catch (error) {
    attempts.set(source, attempt + 1);
    throw error;
  }
}
