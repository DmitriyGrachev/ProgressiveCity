import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="loading">
        <h1>Не удалось открыть приложение</h1>
        <p>{this.state.error}</p>
        <p>
          Локальные данные не удалены. Скопируйте текст ошибки для диагностики.
        </p>
        <button onClick={() => location.reload()}>Повторить загрузку</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
