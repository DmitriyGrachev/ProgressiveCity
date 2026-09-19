import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { MigrationRecovery } from "./features/MigrationRecovery";
import { migrationLimitMessage } from "./storage/limits";
import "./styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string; migrationBlocked: boolean }
> {
  state = { error: "", migrationBlocked: false };
  static getDerivedStateFromError(error: Error) {
    const migration = migrationLimitMessage(error);
    return {
      error: migration ?? error.message,
      migrationBlocked: migration !== undefined,
    };
  }
  render() {
    return this.state.error ? (
      <main className="loading">
        <h1>Не удалось открыть приложение</h1>
        <p>{this.state.error}</p>
        <p>
          Локальные данные не удалены. Скопируйте текст ошибки для диагностики.
        </p>
        {this.state.migrationBlocked && <MigrationRecovery />}
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
