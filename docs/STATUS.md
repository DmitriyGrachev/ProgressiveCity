# Фактический статус — стабилизация 29.10.2026

План: [ROADMAP](ROADMAP.md). Поверх `3cb2c20` исправлены PC-AUD-001/002/003: защита направления от stale fields/epoch, завершённость/согласованность ZIP и CRC, контраст. Локальный ввод сохраняется при конфликте; повторный save работает, ложный success после отказа устранён. Новые регрессии входят в штатный набор и dist. Код/экономика/DB schema/ZIP writer/lockfile не менялись сверх описанных исправлений; новых зависимостей нет.

## Свежие проверки

Последовательно: lint/typecheck/build PASS, **118 unit / 75 e2e / 35 preview / 6 Windows launcher — PASS**, exit0 каждый;0skipped/0automatic retries. Runtime review read-only: новых существенных замечаний после исправления success не найдено. Первые RED и ошибки harness сохранены, точный разбор — [REVIEW_REPORT](REVIEW_REPORT.md).

В отдельной кириллической копии фактические CMD Prepare/Start/Stop, Edge156.0.4314.50 headless, NVIDIA RTX5060/D3D11: полный synthetic daily journey и Stop/Start сохранили материалы/изображение/таблицы/версию. Native beforeunload прошёл в Chromium на dev/dist. По10cold/10repeat GPU samples:100notes median98.6/103.4ms;large1000notes+100placements192.2/185.7ms; ограниченный метод и raw — [PERFORMANCE](PERFORMANCE.md). Серверы/context закрыты, личный5173/профиль не использовались, корневой prepared.json не заменялся.

Полные логи/exit codes/первые падения/GPU raw: `.tools/stabilization-20261029/`. Новые просмотренные synthetic screenshot — `review-evidence/stabilization-*.png`. Новая подготовленная тестовая версия c79ea53db25d; пользовательский Prepare выполните по README после сохранения работы и Stop.

## Следующий этап

Техническая стабилизация завершена. Далее несколько реальных занятий пользователя по сценарию ROADMAP. Системный default-browser **NOT_RUN**, поскольку shell не позволяет изолировать личный профиль; отдельный Edge не подменяет эту проверку. Постоянные аварийные черновики/очистка вложений/свежесть backup — предложения отдельной итерации. Installer/CI/лицензия — после решения о распространении. Recovery в памяти не является crash recovery; консервативный конфликт после собственной архивации TrackForm описан в отчёте.

Git: проверенные намеренные изменения передаются по standing-разрешению AGENTS; точный commit/push/remote HEAD фиксируется итоговым сообщением. Без force/PR/deploy. Полный roadmap не объявляется завершённым до ручной приёмки.

---
# Исторический отчёт реализации — 04.10.2026

04.10.2026. F1–F6 реализованы поверх `33a7f9e1fe57a5001798a23b75bff47a7abfba92`, ветка main. M0–M6: реализация, независимое read-only ревью и приёмка завершены. Экономика, владельцы, этапы, схема БД, городской ZIP и lockfile не изменены. Новых зависимостей, Docker, деплоя, PR, глобальных настроек и расширения разрешений нет. Личный город/профиль и порт 5173 в тестах не использовались.

## Рабочий результат

- Windows Prepare/Start/Stop; Start открывает подготовленную сборку на прежнем 127.0.0.1:5173 без build/install. Readiness, защита статики, неизменяемые releases и signed IPC; чужие порты/PID/проекты не завершаются.
- Поиск по направлениям/исследованиям/заметкам/тегам с клавиатурой, архивом, отдельными действиями и безопасным переходом. Один редактор.
- «Сегодня»: активные habit/reduce, местная дата, реальная Activity/событие дня, draft/zero/reward, полночь и прежняя защита одной награды.
- Безопасные изменённые формы после note flush/images: Save/Stay/Discard, draft без награды, ошибки/partial success/conflicts, epoch и память для восстановления текста после импорта.
- Читаемый materials ZIP: README/Markdown/source JSON/использованные оригинальные изображения; capture/limits/epoch. Прежний полный backup и проверка без замены.
- Отложенные editor/catalog/settings/backup/materials, надёжный retry без reload, проверенный graph. CityCanvas eager, busy не перестраивает сцену; image URL освобождаются.

## Фактическая проверка

Из корня через `node .tools/package/bin/npm-cli.js run <script>`. Windows, Node 22.23.2, npm12.0.2, Chromium153/SwiftShader. Наборы запускались последовательно с завершением предыдущего сервера.

| Проверка | Итог |
|---|---|
| lint | PASS, exit0 |
| typecheck | PASS, exit0 |
| test:unit | 98/98 PASS, 14 файлов, 11.05 с |
| test:e2e | 71/71 PASS, 6.0 мин |
| build | PASS, 4.80 с вместе с tsc; warning >500kB сохранён |
| test:preview | 31/31 PASS, 2.4 мин; transitive optional graph PASS |
| test:launcher | 6/6 PASS, 14.651 с; настоящие Windows CMD, подготовленный dist + S1/Stop–Start |
| perf:report -- after | PASS, шесть холодных запусков; числа PERFORMANCE.md |
| Чистая установка | npm ci --offline в отдельной .tools/daily-clean-install: 249 пакетов/21 с, затем build PASS |

Собственный baseline до изменений: lint/typecheck/build PASS, 90 unit (17.02 с), 54 e2e (5.2 мин), 18 preview (1.9 мин). Первый итоговый e2e имел 70 PASS/1 FAIL: старый конфликт-тест не ждал lazy editor второй вкладки до записи первой. Добавлено наблюдаемое предусловие исходной редакции, обе версии/копия проверяются как раньше; два целевых повтора и весь новый последовательный прогон PASS. Эти неудачные прогоны не скрыты.

S1–S5 пройдены; матрица DAILY_RELEASE_REVIEW.md. Архив S3 создан настоящим кодом предыдущей версии 33a7f9e, новый городской ZIP восстановлен в clean context с сравнением таблиц и Blob. S2: конфликт вопроса + pending image + отказ записи + импорт тех же ID + выгрузка восстановления. Настоящие синтетические PNG просмотрены, сохранены только новые daily-*; старые tracked evidence возвращены из HEAD после перезаписи тестами.

Read-only reviewer нашёл cached failed static dependency и устаревший expected после своей архивации Activity; оба дефекта исправлены, регрессии PASS, повторное ревью без findings. Дополнительно исправлены лишние scene updates от transitioning, Escape заполненного поиска и focus диалога.

## Ограничения и передача

Начальный JS меньше на 32 806 bytes, но общего ускорения нет: медианы пустого экрана 130→93 мс, города со 100 заметками 464→583 мс. Полный JS вырос на 33 244 bytes, запросов стало больше на четыре. Это headless-замер, не аппаратный GPU. Beforeunload и память recovery не гарантируют сохранность после аварии/закрытия. Markdown не история редакций, materials не backup города. Системный выбор браузера по умолчанию не автоматизировался: настоящие CMD проверены с --no-browser и отдельным Chromium.

В текущей папке уже выполнен Prepare, версия **9e9e333a4f49**, сервер личного origin не запускался. Ежедневно: Start; после сохранения: Stop; после обновления: Prepare. Инструкции README.md, решения ARCHITECTURE.md, полный отчёт REVIEW_REPORT.md, матрица DAILY_RELEASE_REVIEW.md.

Git: standing-разрешение на commit/push main подтверждено AGENTS и пользователем. Перед отправкой remote main повторно совпал с BASE_SHA. В commit включается только проверенный пакет и синтетические PNG, без .tools/.progress-city/dist/архивов/runtime. Разрешённая передача выполняется без force; точные SHA и сверка local/remote указываются в итоговом сообщении. Блокеров или незавершённых продуктовых пунктов нет.
