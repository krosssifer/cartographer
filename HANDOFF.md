# HANDOFF — «Картограф» / D&D Battlemap Studio

Документ для следующего рабочего пространства или агента. Дата: 19.11.2026.
Описывает состояние проекта, запуск, архитектуру, уже сделанные улучшения и следующие шаги.

---

## 0. Коротко

- **Что это:** одностраничный генератор и редактор тактических карт D&D на React 19 + TypeScript + Canvas 2D. Сервера нет, всё работает в браузере.
- **Где:** `C:\Users\User\Documents\deepseek-harness\default-workspace`.
- **GitHub:** <https://github.com/krosssifer/cartographer> — **приватный** репозиторий, ветка `main`.
- **История git:** начинается с коммита `418c1ad` («Картограф: генератор и редактор тактических карт D&D»). Вся работа до этого коммита — один начальный снимок; предыдущих коммитов нет.
- **Сейчас приложение запущено:** <http://127.0.0.1:5173/> (dev-сервер Vite, фоновый процесс этой сессии).
- **Статус:** P0, P1 и P2.1 по генерации склепа сделаны и проверены; P2.2/P2.3 (непрямоугольные залы, граф связей и секретные двери, лестницы/этажи) — следующие.

---

## 1. Быстрый старт

Зависимости уже установлены в этой рабочей области, но `node_modules` **не** в git. На чистом клоне:

```powershell
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Проверка типов:

```powershell
node node_modules\typescript\bin\tsc --noEmit
```

Production-сборка (важно: на этой машине нужен TEMP внутри проекта, см. §3):

```powershell
$tmp = Join-Path (Get-Location) '.tmp-build'
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp
npm.cmd run build
```

Результат — `dist/index.html` ≈ **5,34 МБ** (single-file, все текстуры и шрифты встроены). `dist/` и `.tmp-build/` в git не попадают.

| Команда | Что делает |
|---|---|
| `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort` | dev-сервер, HMR |
| `node node_modules\typescript\bin\tsc --noEmit` | проверка типов (сейчас 0 ошибок) |
| `npm.cmd run build` | single-file сборка (нужен TEMP override) |
| `npm.cmd run preview` | просмотр собранного `dist` |

---

## 2. GitHub и git

Установлены в этой рабочей области:

- Git: `C:\Program Files\Git\cmd\git.exe`
- GitHub CLI: `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe`
- Авторизация: `krosssifer`, токен в keyring gh; git настроен через gh credential helper.
- Локальная идентичность: `krosssifer <153861836+krosssifer@users.noreply.github.com>`.

Если `git`/`gh` не находятся в PATH (старая оболочка), используйте полные пути выше либо добавьте:

```powershell
$env:Path = 'C:\Program Files\Git\cmd;C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin;' + $env:Path
```

Типичный цикл:

```powershell
$git = 'C:\Program Files\Git\cmd\git.exe'
& $git status --short
& $git add -A
& $git commit -m "сообщение"
& $git push
```

Проверка удалённого репозитория:

```powershell
& $gh repo view krosssifer/cartographer --json name,visibility,url,defaultBranchRef
```

**Чего нет:** лицензии (`LICENSE`), CI, ESLint/Prettier, `vitest`, `playwright`, `tsx` в зависимостях. Перед публикацией репозитория нужно решить вопрос лицензии и прав на WebP-ассеты.

---

## 3. Ловушки среды (проверено на этой машине)

| Симптом | Причина | Решение |
|---|---|---|
| `npm` не запускается, «выполнение сценариев отключено» | PowerShell 5.1 блокирует `npm.ps1` | использовать `npm.cmd` |
| `spawn EPERM` при `vite`/`npm run dev` | esbuild поднимает дочерний процесс через pipe-каналы; sandbox их блокирует | запускать с полным доступом (в этой сессии — `danger-full-access`) |
| `EBUSY: ... .tmpdir\...` и падение Vite | редакторы/агенты пишут файлы через sidecar-каталоги `*.tmpdir`, chokidar пытается их наблюдать | уже исправлено в `vite.config.ts`: `server.watch.ignored` для `**/*.tmpdir/**`, `**/*.tmp`, `node_modules`, `.git`. Не удалять |
| `build` падает: `Access is denied` при удалении `%TEMP%\esbuild-*` | esbuild не может удалить свой временный файл в системном TEMP | перед сборкой задать `TEMP`/`TMP` внутри проекта: см. §1 |
| `pwsh` не найден | в системе Windows PowerShell 5.1, не PowerShell 7 | использовать `powershell.exe`; для `.ps1` — `powershell.exe -NoProfile -ExecutionPolicy Bypass -File script.ps1` |
| Кириллица в inline-командах PowerShell ломается | кодировка консоли/аргументов | хранить русский текст в `.ps1` с BOM или в файлах, не в командах |
| Переменные `$w` и `$W` конфликтуют | PowerShell не различает регистр | не использовать имена, различающиеся только регистром (временные скрипты уже на этом спотыкались) |
| `scripts/*.ts` не запускаются напрямую | импорты без расширений, `tsx` не установлен | `npm i -D tsx` или временная копия с `.ts` в импортах (Node 24 умеет strip types) |
| Браузерные тесты не запускаются | нет `playwright` | `npm install --no-save playwright`, `npx playwright install chromium`, затем dev-сервер и `node scripts/*.cjs` |

Полезно знать:

- Node **v24.21.0**, npm **12.2.0**, Git **2.56**, Vite **7.3.7**, React **19.2.6**, TypeScript **5.9.3**.
- В рабочей области уже был инцидент: Vite падал от временных каталогов редактора. Игнор в конфиге стабилен, проверен правками.
- `gh auth setup-git` требует git в PATH у процесса gh; при необходимости сначала расширьте PATH.

---

## 4. Архитектура

```
src/
  main.tsx, App.tsx            точка входа и состояние приложения
  components/                  панели и CanvasEditor (23 пропса у канвы)
  lib/
    types.ts                   модель данных
    generator.ts               биомы, пещеры, подземелья, вода, двери
    cryptLayout.ts             архетипы, планировка, декор, размещение
    cryptKit.ts                каталог 158 объектов склепа и их правила
    cryptPaint.ts, cryptArt.ts, cryptVectors.ts   отрисовка склепа
    settlement.ts, settlementEdits.ts, settlementKit.ts, settlementPaint.ts  поселения
    interiors.ts, interiorPaint.ts, furnitureKit.ts, furnitureImport.ts       интерьеры
    render.ts, terrainPaint.ts, palette.ts, doors.ts, chests.ts               рендер
    edits.ts                   иммутабельные операции редактора, prune
    project.ts                 схема v1, валидация, localStorage, JSON
    assets.ts, fonts.ts        загрузка встроенных ассетов
    noise.ts, random.ts        детерминированный шум и PRNG
    presets.ts                 биомы, пресеты, DEFAULT_GEN, архетипы склепа
scripts/                       проверки: 6 браузерных сценариев (5 .cjs + drag-walls-test.ts) и 4 чистых tsx-теста + подготовка ассетов
docs/                          ANALYSIS-AND-PLAN.md и docs/crypt (схемы/скриншоты)
assets/source/                 исходная иллюстрация (не входит в сборку)
```

Поток данных:

```
GenSettings ──generateMap()──► MapData ──renderMap(canvas)──► холст/PNG
      ▲                            │
      │                            └── edits.ts: map → newMap (cloneMap)
      └── ControlPanel            App: history {gen, edit}, localStorage
```

`MapData` — единственный источник правды для карты; `renderMap(canvas, map, render, seed)` — чистая функция отображения.

---

## 5. Модель данных

`GenSettings` (см. `src/lib/types.ts`):

- `seed`, `biome` (9: forest/plains/swamp/desert/snow/cave/dungeon/village/town)
- `width` 10–100, `height` 10–80, `roughness`, `waterLevel` (0–0.7), `vegetation`, `rocks`, `structures` (0–6), `ruined`, `river`, `road`, `caveOpenness`, `rooms` (2–14), `settlement`, `density`, `publicSpaces`
- `cryptDetail` (0–1), `cryptTraps`, `cryptChasms`, **`cryptArchetype`** (`tomb | catacombs | temple | archive | prison`, по умолчанию `tomb`)

`MapData`: `width`, `height`, `biome`, `cells: Cell[][]`, `trees`, `rocks`, `structures`, `buildings?`, `civic?`, `crypt?`, `cryptRooms?`, `furnitureSprites?`, `chests`, `river`, `road`.

`Cell`: `terrain` (22 значения), `height`, `moisture`.

`CryptObject`: `kind`, `x/y/w/h`, `rotation`, `variant`, `source: 'layout'|'manual'`, `hidden?` (тайные ловушки). `CryptRoom`: прямоугольник + `theme` (8 тем).

`Project` (`project.ts`): `version: 1`, `gen`, `render`, `map: MapData | null`, `editor?`.

- `map: null` означает «правок не было, восстанови карту из seed». После правки хранится полный снимок.
- localStorage: ключ `battlemap-studio-project-v1`; импорт JSON ≤ 8 МБ; до 16 пользовательских спрайтов по ≤ 240 000 символов base64.
- Валидация строгая по диапазонам и лимитам, но старые проекты без новых полей получают дефолты (`cryptArchetype: 'tomb'`, `showRoofs` и т. п.).

---

## 6. Как генерируется склеп

1. **План залов** — `cryptBlueprint` (архетип; `cryptRoomCapacity` = `floor((width-3)/5) * floor((height-3)/5)`, затем `min(rooms, capacity)`), с гарантией числа через `finishLayout`/`packBlueprint`.
2. **Вырубка** — `generateDungeon`: прямоугольные комнаты, MST-коридоры (ближайший + петля), стены в одну клетку с удалением внутреннего слоя.
3. **Двери** — эвристика 85% + гарантирующий проход: у каждого зала появляется дверь на периметре (кроме одночного зала).
4. **Вода** — лужи по низким клеткам зала (отступ от стен, не коридор, не у двери), вода проходима (`open` включает `water`).
5. **Декор** — `decorateCrypt`:
   - BFS-глубина от входа, темы: `entry` снизу, главный зал — по архетипу (`CRYPT_HALL_THEME`), остальные — по `ARCHETYPE_THEMES`;
   - зарезервированные проходы (BFS-«осевые» клетки) и запрет блокировки дверей;
   - опасности только в `sanctum/burial/ossuary/storage`;
   - базовый набор (`BASE`) + свет (`LIGHT`), сцены (`SCENES`, 2 на тему), настенные украшения (`WALL_ORNAMENTS`);
   - бюджет мебели `round(площадь × (0.028 + 0.155 × detail))`, слот-ориентированный RNG;
   - ловушки только в коридорах, с приоритетом 2–3 клеток перед дверью.
6. **Рендер** — `renderMap` рисует рельеф, стены, двери, дома, объекты, свет, сетку.

### Архетипы

| id | Планировка | Главный зал |
|---|---|---|
| `tomb` | BSP + центральный зал | `sanctum` |
| `catacombs` | колонны небольших камер 4–7 × 4–6 | `sanctum` |
| `temple` | зал до 18×13 + приделы | `sanctum` |
| `archive` | два ряда длинных залов 9–15 × 4–5 | `archive` |
| `prison` | камеры 4×4 + пост 8×7 | `watch` |

### Детерминизм и монотонность (важно не сломать)

- Только `mulberry32`/`hash2`/`mixSeed`; `Math.random` в генерации нет.
- Сид раскладки зависит от зала и слота (`rngFor(seed, room.x, room.y, salt)`), а не от длины `map.crypt`; поэтому рост детализации **добавляет** предметы, не двигая уже поставленные.
- Тест `crypt-test.ts` проверяет `detail 0.4 ⊆ 0.7`; сохраняйте это свойство.
- Изменение алгоритма меняет карты у проектов с `map: null`; сохранённые карты не меняются. Версии генератора пока нет.

---

## 7. Что сделано

### P0 — гарантии и базовое качество
- Число залов = `min(запрошено, вместимость)`, запасная сетка; панель показывает «Залы N из M».
- Дверь у каждого зала; одночный зал без двери.
- Темы по глубине; главный зал по размеру/глубине.
- Опасности только в подходящих залах.
- Детализация монотонна (слот-сиды, скелет до мебели).
- Базовый набор и свет в каждом зале (в т. ч. при detail 0).
- Ловушки только в коридорах, не на проходе.
- Тесты расширены; UI-подсказки.

### P1 — сцены и читаемость
- Сцены на каждую тему (алтарь со свечами и кругом, саркофаги, стеллажи, витрины, клетки, ящики).
- `wallFace`: 9 видов (знамя, гобелен, зеркало, маска, занавес, святилище, колокол, каменный глаз, храмовые маски) — только на стенах; `canPlaceCrypt`/`pruneCrypt` учитывают.
- Второй источник света в больших залах; ловушки перед дверьми.
- Лужи по низким местам, вода проходима.
- README и `docs/crypt/` обновлены.

### P2.1 — архетипы
- Пять планировок, тематические порядки и главные залы, селект «Тип склепа» в панели генерации.
- Валидация и миграция старых проектов (по умолчанию `tomb`).
- Тесты и документация.

Ключевые файлы изменений: `src/lib/cryptLayout.ts`, `src/lib/generator.ts`, `src/lib/cryptKit.ts`, `src/lib/types.ts`, `src/lib/presets.ts`, `src/lib/project.ts`, `src/lib/edits.ts`, `src/components/ControlPanel.tsx`, `src/components/CryptPanel.tsx`, `scripts/crypt-test.ts`, `vite.config.ts`, `README.md`, `docs/crypt/*`.

---

## 8. Проверки и их состояние

| Проверка | Как | Результат на момент handoff |
|---|---|---|
| Типы | `node node_modules\typescript\bin\tsc --noEmit` | 0 ошибок |
| Крипт-тест (все архетипы) | `npx tsx scripts/crypt-test.ts` (нужен tsx) | проходит: 125 авторазмещённых вида, 5 архетипов × 6 размеров × 4 seed |
| Планировки поселений | `npx tsx scripts/layout-test.ts` | проходит |
| Сборка | `npm.cmd run build` с TEMP override | 5,34 МБ, 127 модулей |
| Браузер | Playwright + dev-сервер | приложение открывается, консольных ошибок нет |
| Кастомный sweep | временный harness (в репозиторий не входит) | ALL CHECKS PASSED: число залов, двери, свет, вода, опасности, монотонность по архетипам |

Примечание: `tsx` и `playwright` **не** объявлены в `package.json`. Для запуска TS-тестов без установки `tsx` использовался приём: копия `src/lib` и `scripts/*.ts` во временную папку, добавление `.ts` к относительным импортам, запуск через Node 24 (type stripping). При следующей сессии проще поставить `tsx` и `playwright`, чем повторять копирование.

Браузерные сценарии (`scripts/*.cjs`) требуют dev-сервера и Playwright; часть из них обновлена под новое поведение (детализация 0, архетипы), но не запускалась после последних изменений.

---

## 9. Что осталось

### P2.2 — структура (следующий логичный шаг)
1. Непрямоугольные залы: L/T-формы, ниши, колоннады. Потребует расширить `CryptRoom` (доп. прямоугольник/полигон), `contains/midpoint`, размещение и рендер.
2. Граф залов: связи с типами (`door`, `arch`, `secret`, `locked`) и секретные двери. Сейчас двери — только `terrain`, идентичности и состояния нет.
3. Лестницы/этажность: `level` у стен/объектов, переключение этажа, вход с поверхности.

### P2.3 — качество
- Golden-фикстуры генерации (sha256 для наборов seed/размер/архетип).
- CI (typecheck + build + unit), `vitest`, `@playwright/test`, ESLint/Prettier.
- Перф-бюджеты для 100×80 и тест «detail монотонен».

### Другие треки (см. `docs/ANALYSIS-AND-PLAN.md`)
- **Данные:** `generatorVersion`, карантин битой сессии и квота localStorage, стабильные ID, схема v2, IndexedDB.
- **VTT (отложено пользователем):** `SceneBundle`, `.dd2vtt`, второй экран. Не начинать без явного запроса.
- **Рендер:** rAF + слои + чанковый кэш, DPR, баг «ландшафт меньше холста при cellSize > 48», производительность 100×80.
- **UX:** тач-жесты, a11y канвы, тосты/диалоги, дизайн-токены, i18n.

---

## 10. Правила для следующего агента

- Сначала прочитать этот файл, `README.md` и `docs/ANALYSIS-AND-PLAN.md`.
- Интерфейс — на русском; стиль кода — существующий (2 пробела, `import type`, иммутабельные операции).
- Любая правка генератора должна сохранять детерминизм и монотонность детализации; обновляйте `scripts/crypt-test.ts` и проверяйте `tsc`.
- Не удаляйте `server.watch.ignored` в `vite.config.ts` — иначе Vite снова начнёт падать с `EBUSY`.
- Не коммитьте `node_modules`, `dist`, `.tmp-build`, `.env`, временные каталоги; не добавляйте секреты.
- Не добавляйте зависимости без необходимости; если добавляете — фиксируйте версии.
- Перед пушем: `git status`, `tsc --noEmit`, при изменениях генерации — `crypt-test`.
- Репозиторий приватный; публикация и лицензия — только по решению владельца.
- Если меняете формат проекта — обновите `project.ts`, тест миграции и README.

---

## 11. Полезные ссылки и файлы

- Репозиторий: <https://github.com/krosssifer/cartographer>
- Приложение: <http://127.0.0.1:5173/>
- Анализ и дорожная карта: `docs/ANALYSIS-AND-PLAN.md`
- Схемы и скриншоты: `docs/crypt/` (`archetypes.png`, `app-archetype-ui.png`, `after-p1-seed-1337.png` и др.)
- Пресеты и архетипы: `src/lib/presets.ts`
- Планировка и декор: `src/lib/cryptLayout.ts`
- Модель: `src/lib/types.ts`
- Формат проекта: `src/lib/project.ts`
- Тест склепа: `scripts/crypt-test.ts`

---

## 12. Журнал

- **19.11.2026** — P0 (гарантии склепа), P1 (сцены, настенные предметы, вода, ловушки у дверей), P2.1 (5 архетипов); Git-репозиторий инициализирован, проект залит на GitHub (`418c1ad`).
- **19.11.2026** — добавлен этот handoff.
