# Приёмка «Ежедневное использование» — 04.10.2026

BASE_SHA: `33a7f9e1fe57a5001798a23b75bff47a7abfba92`. F1–F6 реализованы поверх существующего приложения. Итоговый последовательный прогон: lint/typecheck PASS, 98/98 unit, 71/71 e2e, build PASS, 31/31 preview; затем 6/6 Windows launcher и perf PASS. Детали и первый неудачный прогон — REVIEW_REPORT.md. Личный город/профиль и порт 5173 не использовались.

Обозначения доказательств (все пути от корня):

- **L** — `tests/launcher/launcher.test.mjs`, `npm run test:launcher`, Windows, шесть сценариев. `prepare, concurrent start…` — readiness, static boundaries и restart; `foreign port…` — чужой процесс/проект/PID; `stale sources…` — build/tool failures; `actual Windows cmd wrappers…` — настоящие cmd.
- **A** — `tests/e2e/daily-access.spec.ts`: `quick search keeps one editor…`, `search respects archives…`, `today keeps an open date…`, `today opens a real habit draft…`.
- **F** — `tests/e2e/daily-forms.spec.ts`, пять `daily forms:` сценариев: save/stay/discard; partial save; import same IDs; draft/unload; archive then edit.
- **E** — `tests/e2e/daily-materials.spec.ts`: `materials export flushes the note…`, `quick backup verifies a file…`.
- **D** — `tests/e2e/daily-release.spec.ts`, четыре `daily release:` сценария: previous v2/daily journey/roads/A-B/restore; images/conflict/import; narrow keyboard; image URL lifecycle. Общий публичный путь — `tests/e2e/daily-journey.ts`, повторно используется настоящим Windows launcher.
- **O** — `tests/e2e/daily-loading.spec.ts`: `optional editor loading…`, `optional materials loading…`; `scripts/check-build-graph.mjs` перед preview.
- **U** — `tests/unit/daily-access.test.ts` (ранг/событие/конфликт), `tests/unit/materials.test.ts` (пять сценариев capture/JSON/images/limits/epoch).
- **C** — сохранённые `continuation.spec.ts`, `comparison.spec.ts`, `planning.spec.ts`, `readability.spec.ts`, `migration-limit.spec.ts` и unit-регрессии. Не удалялись и не подменялись моками.

| ID | Требование | Статус | Реализация, проверка и граница |
|---|---|---|---|
| F1.1 | Prepare отдельно от Start | DONE | Три корневых cmd, `scripts/launcher/cli.mjs`. L: неизменность prepared.json после повторного Start, отсутствие build/install в Start. |
| F1.2 | Прежний origin, readiness, конкурентный запуск | DONE | `core.mjs`/`server.mjs`, lock + проверка project/instance/build. L: два Start, повтор, restart на явном тестовом 45173. Штатный порт в коде 5173, fallback отсутствует. |
| F1.3 | Stop только своего процесса | DONE | Подписанный IPC, без убийства PID. L `foreign port, another project and stale PID never stop a foreign server`: сервер отвечает после попыток чужого Start/Stop. |
| F1.4 | Только статика сборки | DONE | Allowlist release + realpath. L: raw encoded/double-encoded traversal, Windows backslash/drive, .git/.tools/src, POST отказ. Секрет не выдаётся health. |
| F1.5 | Windows/пути/отказы | DONE | L: настоящие cmd из другой cwd, пробелы и кириллица, missing Node/npm/deps/build, failed Prepare сохраняет прежний указатель, active Prepare запрещён. OS-выбор браузера не автоматизировался: `--no-browser`, отдельный Chromium. |
| F2.1 | Общий поиск | DONE | `domain/search.ts`, SearchPalette. U `search ranks titles…`; A title/text/tag/архив, D публичное продолжение существующей заметки без дубликата. До 12 строк, полная библиотека отдельно. |
| F2.2 | Keyboard/focus/editor | DONE | A один DOM editor, Ctrl+K, arrows/Enter/Escape/focus; D narrow + reduced motion. Escape закрывает и заполненный поиск. Стрелки прокручивают выбранную строку. |
| F2.3 | Безопасный переход/epoch/без здания | DONE | `app/search.ts`: reread владельцев/epoch; A unbuilt/archived/failed write; D import при открытой палитре сбрасывает контекст. В истории/A-B кнопка и shortcut заблокированы. |
| F3.1 | День по локальной дате | DONE | TodayPanel + `domain/habits.ts`, прежняя ActivityForm. A midnight/timezone: открытая дата не меняется, новая запись предлагает сегодня. |
| F3.2 | Draft/zero/reward | DONE | U событие как источник награды, A и D реальные записи. Значение/достижение не подставляются как факт, расписание только текст. Ноль объясняется до подтверждения. |
| F3.3 | Retry/две вкладки/одна награда | DONE | A `today keeps an open date…`: отказ записи события, retry, две вкладки и один event. A `today opens…`: нулевая награда закрепляет день. C прежние idempotency сохранены. |
| F4.1 | Три решения для форм | DONE | `pending-forms.tsx`, Research/NextQuestion/Activity. F save/stay/discard и несколько участников. Dialog сохраняет только названные формы, заметка flush раньше. |
| F4.2 | Note + form/images/error/conflict | DONE | D images/conflict/import, F partial save, C `question failure and two-tab field conflict…`, pending image/copy. Ввод остаётся, поля блокируются при записи; частичный успех указан явно. |
| F4.3 | Результат сохраняется черновиком | DONE | F `leaving a result saves a draft…` + partial save: данные Activity сохранены, confirmed false, новых наград нет. F archive then edit не создаёт ложный конфликт и event. |
| F4.4 | Старый ввод не пишет в новый город | DONE | F same IDs и D импорт во второй вкладке: поля старого epoch сохранены лишь в памяти, заметка/2 изображения выгружаются через RecoveryTray. Новые данные не перезаписаны. |
| F4.5 | Unload и пределы восстановления | DONE | F проверяет preventDefault на beforeunload; README объясняет память вкладки и отсутствие crash recovery. Вид системного окна/политика браузера не гарантируются. |
| F5.1 | Markdown/JSON/изображения | DONE | `storage/materials.ts`, `domain/materials.ts`, кнопки NoteEditor/ResearchDetails. U точный JSON и исходные байты изображений; E заметка/исследование/пустое исследование, D реальный файл. |
| F5.2 | Безопасные имена/code/URL/dedup | DONE | U dangerous names, escaped HTML/Markdown, URL schemes, fenced code, уникальные paths, один файл на attachmentID. Недоступное в Markdown оформление явно перечислено, точный source JSON сохранён. |
| F5.3 | Согласованный readonly export | DONE | U capture независим от последующих правок, смена epoch во время Blob packing отменяет выдачу. E dirty flush/failed save не выгружает старую версию. В UI «передан браузеру», без обещания записи на диск. |
| F5.4 | Прежний backup/проверка | DONE | QuickBackup переиспользует exportCity/inspectArchive. E проверяет отсутствие замены epoch и отказ materials как city; D новый полный ZIP восстановлен в чистой базе с точным сравнением таблиц и Blob. |
| F6.1 | До/после в одинаковых условиях | DONE | По три холодных запуска двух состояний до/после, одинаковый `scripts/perf-report.mjs`, PERFORMANCE.md. JS −32 806 bytes; медианы 130→93/464→583 мс. Общее ускорение не заявляется, наполненный город медленнее. |
| F6.2 | Lazy + retry без потери ввода | DONE | O editor отказ/повтор без reload; materials отказ при живом editor, текст можно продолжить и выгрузить. Build graph проверяет все статические зависимости optional entry. Tiptap validator синхронный, CityCanvas eager. |
| F6.3 | Один canvas, сцена и URL | DONE | A zero CityEngine.update при note/search/переходе в тот же материал; C save/hover/labels/frozen comparison; D один URL через три открытия поиска, ноль после закрытия редактора, один canvas. setBusy отдельно от графики. |
| S1 | Полный ежедневный путь/Stop–Start | DONE | L `real prepared application…` вызывает общий dailyJourney на настоящем подготовленном dist, проверяет version, Stop/Start/reload, материал/изображение/вопрос. D отдельно сравнивает итоговые балансы и связанные данные. |
| S2 | Несохранённое/две вкладки/import | DONE | D: dirty-вопрос, peer сохраняет другой вопрос, конфликт; pending image + отказ note write при переходе из поиска; импорт прежних ID сбрасывает palette, сохраняет оба recovery; выгрузка двух изображений. C повтор подтверждения не даёт очки. |
| S3 | Предыдущий город/новые потоки/ZIP | DONE | `daily-fixture.mjs` создаёт v2 настоящим кодом BASE_SHA; D F2–F5, 4 клетки дороги одним жестом + undo/redo, A/B readonly и камера, полный ZIP → fresh context, сравнение всех таблиц кроме нового epoch и байтов вложений. v1/границы остаются в C. |
| S4 | Неудобный запуск | DONE | Все L на Windows: пробелы/кириллица, другой cwd, чужой порт/PID/проект, два Start, stale source, отсутствие сборки и инструментов, неудачный Prepare. |
| S5 | Настоящий UI | DONE | D/C на 1440×1000 и 390×844, клавиатура/focus/dialog/readonly/reduced motion/no horizontal overflow, pageerror; просмотрены настоящие PNG в review-evidence. Личный профиль не использовался. |

## Материалы проверки

Снимки `review-evidence/daily-city.png`, `daily-search-mobile.png`, `daily-form-mobile.png`, `daily-recovery.png`, `daily-comparison.png` сделаны браузером на синтетическом городе, не являются макетами. Исходный архив создаётся локально перед наборами, не коммитится. Browser plugin недоступен; использован установленный Playwright/Chromium 153 на Windows, SwiftShader. Аппаратный GPU и выбор личного браузера по умолчанию не проверялись.

Отдельный read-only reviewer нашёл два P2: cached failed static dependency при retry и устаревший expected Activity после своей архивации. Обе причины подтверждены; исправления проверены регрессиями и повторным read-only ревью без новых findings. Дополнительные реальные прогоны выявили лишние scene updates при busy, Escape в search input и стартовый фокус dialog; исправлены и перепроверены.

Ограничения: несохранённые формы/recovery живут в памяти вкладки; Markdown не история редакций; materials не городской архив; ручной выбор привычки не оценка расписания; headless времена не гарантия скорости на устройстве пользователя. Схема БД, городской ZIP, экономика и зависимости не менялись. Деплой/PR не выполнялись.
