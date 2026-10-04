import { Component, Suspense, lazy, type ComponentType } from "react";

/** Each mounted feature retries only its own chunk, never reloads the page. */
export function lazyFeature<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
) {
  return class LazyFeature extends Component<P> {
    state = { failed: false, View: lazy(load) };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      const View = this.state.View;
      if (this.state.failed)
        return (
          <section className="notice" role="alert">
            <p>
              Не удалось открыть модуль. Сохранённые данные остались на
              устройстве. Проверьте, работает ли локальный запуск.
            </p>
            <button
              onClick={() => this.setState({ failed: false, View: lazy(load) })}
            >
              Повторить загрузку {label}
            </button>
          </section>
        );
      return (
        <Suspense fallback={<p role="status">Загрузка {label}…</p>}>
          <View {...this.props} />
        </Suspense>
      );
    }
  };
}
