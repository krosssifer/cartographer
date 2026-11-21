#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Harness: автогенерация спрайт-листов через веб-интерфейс Gemini (Playwright + Firefox).

Что делает скрипт:
  1. Запускает Firefox через Playwright с копией вашего профиля (там уже есть вход в Google).
  2. По очереди открывает https://gemini.google.com/app, отправляет промт и ждёт картинку.
  3. Скачивает оригинал листа в RAW_OUTPUT_DIR.
  4. Режет лист на тайлы по сетке (2x2, 3x3, ...), убирает белый фон, обрезает поля.
  5. Сохраняет готовые спрайты в FINAL_SPRITES_DIR с именами из задания
     (или {имя}_01, {имя}_02, ... если имена не заданы).
  6. Ведёт лог, продолжает работу при ошибках, делает паузы между запросами.

Установка зависимостей (Windows, PowerShell/cmd):
    pip install playwright pillow
    python -m playwright install firefox

    # необязательно: нейросетевое удаление фона вместо вырезания белого
    pip install rembg onnxruntime

Запуск:
    python gemini_sprites.py --check          # проверка: профиль, вход, селекторы (без генерации)
    python gemini_sprites.py --dry-run --all  # показать план, ничего не открывать
    python gemini_sprites.py --only rocks     # один лист
    python gemini_sprites.py --all            # все листы
    python gemini_sprites.py --all --force    # перегенерировать уже готовые

Важно:
  * Перед запуском закройте Firefox — иначе профиль заблокирован (скрипт копирует
    профиль, так что это не критично, но копия делается только когда файлы не заняты).
  * Первый запуск лучше делать без --headless: скрипт откроет окно, где видно,
    что происходит; при необходимости можно один раз войти в аккаунт вручную.
  * Автоматизация веб-интерфейса Gemini нарушает условия использования Google —
    используйте на свой риск (возможны капча и ограничения аккаунта).
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# ============================================================================
# 1. КОНФИГУРАЦИЯ
# ============================================================================

# Папка профиля Firefox, где вы уже авторизованы в Google.
# По умолчанию берём профиль "default-release" текущего пользователя.
FIREFOX_PROFILE_DIR = Path(
    os.environ.get(
        "FIREFOX_PROFILE_DIR",
        str(Path(os.environ.get("APPDATA", "")) / "Mozilla" / "Firefox" / "Profiles" / "j0jfm7io.default-release"),
    )
)

# Копировать профиль перед запуском (настоятельно рекомендуется: Firefox может
# быть открыт, а Playwright не умеет работать с занятым профилем).
COPY_PROFILE = True

# Куда складывать исходные скачанные листы.
RAW_OUTPUT_DIR = Path(r"C:\AbsoluteDND\cartographer\assets\source\generated\web")

# Куда ставить нарезанные спрайты (папка проекта).
# Для генератора карт D&D это src/assets/cartography.
FINAL_SPRITES_DIR = Path(r"C:\AbsoluteDND\cartographer\src\assets\cartography")

# В каком формате сохранять финальные спрайты: "webp" (проект требует .webp) или "png".
FINAL_FORMAT = "webp"

# Удалять ли однотонный (белый) фон у тайлов: True/False.
# Если хотите нейросетевой rembg — поставьте True и USE_REMBG = True.
REMOVE_BG = True
USE_REMBG = False

# Обрезать пустые поля вокруг спрайта после удаления фона.
TRIM = True
# Отступ вокруг спрайта после обрезки, px.
PADDING = 6

# Ограничение размера готового спрайта по большей стороне (0 — не ограничивать).
WEBP_QUALITY = 86
MAX_SPRITE_SIZE = 420

# Пауза между запросами к Gemini (сек). Маленькие паузы = больше риск лимитов.
DELAY_BETWEEN_TASKS = 28
# Ожидание рендера картинки после исчезновения кнопки Stop (сек).
RENDER_WAIT = 4.0

GEMINI_URL = "https://gemini.google.com/app"

# Обязательный стилевой префикс. Он склеивается с описанием каждого листа.
STYLE_BLOCK = (
    "Hand-painted tabletop RPG battle-map art, strictly top-down orthographic view "
    "(bird's eye, looking straight down), painterly gouache illustration with soft "
    "watercolor shading, clean 1-2 px dark ink outline, warm natural palette, light "
    "from upper-left, high detail, professional fantasy cartography asset. "
    "Layout: exact square sprite sheet, evenly spaced objects on a pure white "
    "background (#FFFFFF), objects centered in their cells with generous empty "
    "margins, objects must not touch or overlap cell borders, no ground shadows, "
    "no text, no labels, no watermark, no frame, no border, no paper texture."
)

# Негативные уточнения — дописываются в конец каждого промта.
NEGATIVE_BLOCK = (
    "Avoid: isometric, three-quarter view, perspective, cast shadows, text, letters, "
    "watermark, logo, UI frame, border, pixel art, blurry, photo of a miniature."
)

# ---------------------------------------------------------------------------
# Текстуры земли: отдельный стиль — одно бесшовное полотно, без объектов.
# ---------------------------------------------------------------------------
TEXTURE_STYLE = (
    "Hand-painted tabletop RPG battle-map terrain texture, strictly top-down "
    "orthographic view (camera pointing straight down), painterly gouache illustration, "
    "soft watercolor shading, warm natural palette, light from upper-left, "
    "even uniform lighting across the whole frame. "
)

# Требования, которые критичны именно для тайлинга.
SEAMLESS_RULES = (
    "SEAMLESS TILEABLE TEXTURE: the image must tile perfectly in all four directions — "
    "the left edge must continue exactly into the right edge and the top edge into the "
    "bottom edge, with no visible seam, no border, no vignette, no gradient toward the "
    "corners, no repeating landmark that reveals the tile boundary. "
    "Fill the ENTIRE square frame edge to edge with the material; no margins, "
    "no objects, no props, no text, no watermark."
)

TEXTURE_NEGATIVE = (
    "Avoid: objects, bushes, stones, trees, props, characters, shadows, text, "
    "watermark, border, frame, vignette, dark corners, isometric, perspective, "
    "pixel art, photographic noise, visible tiling seam."
)

# 16 материалов, которые реально использует генератор (см. MATERIALS в assets.ts).
# Имена файлов совпадают с проектом — поэтому overwrite=True (заменяем базовый файл).



@dataclass
class Task:
    """Одно задание: лист, который надо сгенерировать и нарезать."""

    name: str                     # имя файла без расширения (латиницей)
    description: str              # что нарисовать (без стиля — он добавится сам)
    rows: int = 2                 # сетка нарезки
    cols: int = 2
    names: list[str] = field(default_factory=list)  # имена тайлов; пусто → {name}_01...
    # --- опции для текстур (бесшовные тайлы, без нарезки на объекты) ---
    seamless: bool = False        # использовать «текстурный» стиль и бесшовную постобработку
    overwrite: bool = False       # писать поверх базового файла (grass.webp), а не как вариант -2
    remove_bg: bool | None = None  # переопределить глобальный REMOVE_BG
    trim: bool | None = None       # переопределить глобальный TRIM
    max_size: int | None = None    # переопределить MAX_SPRITE_SIZE
    lossy: bool = False            # webp с потерями (для текстур — чтобы не раздувать бандл)


# Список заданий. Имена тайлов намеренно совпадают с именами спрайтов проекта:
# если файл уже существует, будет создан вариант name-2.webp, name-3.webp и т.д.
TASKS: list[Task] = [
    Task(
        name="rocks-2",
        description=(
            "Four separate rock assets seen from directly above: (1) a large grey granite "
            "boulder with mossy top, (2) a small cluster of three rounded stones, "
            "(3) a jagged rocky outcrop, (4) a scattering of loose scree pebbles."
        ),
        names=["rock", "smallRock", "rock", "rock"],
    ),
    Task(
        name="trees-3",
        description=(
            "Four separate tree canopies seen from directly above: (1) a light birch tree, "
            "(2) a wide willow with long hanging branches, (3) a tall dark spruce, "
            "(4) a bare dead tree with twisted branches."
        ),
        names=["oak", "oak", "pine", "dead"],
    ),
    Task(
        name="walls-2",
        description=(
            "Four separate flat stone wall pieces seen from directly above: "
            "(1) a straight stone wall strip, (2) the same wall overgrown with ivy, "
            "(3) a stone wall corner turn, (4) a short ruined wall stub with rubble."
        ),
        names=["wall-straight", "wall-straightIvy", "wall-column", "wall-end"],
    ),
    Task(
        name="dungeon-traps",
        description=(
            "Four separate dungeon trap assets seen from directly above: "
            "(1) a square floor pit filled with rusty iron spikes, (2) a round stone "
            "pressure plate, (3) a wall section with dart holes and protruding darts, "
            "(4) an iron portcullis grate."
        ),
        names=["crypt-pitSpikes", "crypt-pressurePlateRound", "crypt-dartHoleWall", "crypt-portcullis"],
    ),
    Task(
        name="decor-grass",
        description=(
            "Four separate small ground decorations seen from directly above, each tiny: "
            "(1) a tuft of grass blades, (2) a cluster of white and yellow wildflowers, "
            "(3) a single fallen dry leaf, (4) a patch of moss."
        ),
        names=["decor-tuft", "decor-flower", "decor-leaf", "decor-moss"],
    ),
    Task(
        name="decor-stone",
        description=(
            "Four separate small ground decorations seen from directly above, each tiny: "
            "(1) a single small pebble, (2) a dry twig, (3) a thin crack in stone, "
            "(4) a small patch of white snow."
        ),
        names=["decor-pebble", "decor-twig", "decor-crack", "decor-snow"],
    ),
    # --- крипта: погребальные объекты (4 шт., сетка 2x2) ---
    Task(
        name="crypt-burial-2",
        description=(
            "Four separate stone burial props seen from directly above: (1) a closed carved "
            "stone sarcophagus with a lid and moss in its cracks, (2) a half-open stone coffin "
            "with a dark interior and its lid pushed aside, (3) a heavy carved stone sarcophagus "
            "lid lying flat with a knight effigy, (4) a weathered rectangular gravestone slab "
            "lying flat with worn engraved lines."
        ),
        rows=2,
        cols=2,
        names=["crypt-coffin", "crypt-openCoffin", "crypt-sarcophagusLid", "crypt-graveStone"],
    ),
    # --- крипта: реликвии и алтари (4 шт., сетка 2x2) ---
    Task(
        name="crypt-relics-2",
        description=(
            "Four separate ancient stone relics seen from directly above: (1) a stone altar "
            "block with a stained top and carved side panels, (2) a wooden reading lectern with "
            "an open ancient book on it, (3) a weathered hooded stone statue seen from above so "
            "mostly the head and shoulders are visible, (4) a stone statue standing on a square "
            "pedestal, also seen from above."
        ),
        rows=2,
        cols=2,
        names=["crypt-altar", "crypt-lectern", "crypt-statue", "crypt-pedestalStatue"],
    ),
    # --- крипта: ловушки (4 шт., сетка 2x2) ---
    Task(
        name="crypt-traps-2",
        description=(
            "Four separate dungeon traps seen from directly above: (1) a square stone pit filled "
            "with rusty iron spikes pointing up, (2) a flagstone floor plate covered with rows of "
            "thin metal spikes, (3) a rusty circular saw blade set flat into a floor slot, "
            "(4) an iron portcullis grate with a heavy stone frame."
        ),
        rows=2,
        cols=2,
        names=["crypt-pitSpikes", "crypt-spikeField", "crypt-sawBlade", "crypt-portcullis"],
    ),
    # --- интерьеры: мебель (9 шт., сетка 3x3) ---
    Task(
        name="furniture-3",
        description=(
            "Nine separate pieces of medieval tavern furniture seen from directly above, "
            "arranged in a three by three grid: (1) a round wooden table, (2) a wooden chair "
            "with visible backrest, (3) a bed with a patchwork quilt and pillow, (4) a tall "
            "wooden wardrobe seen from above, (5) a stone hearth with glowing embers, "
            "(6) an ornate woven rug with a geometric pattern, (7) a cluster of wooden barrels, "
            "(8) a stack of wooden crates, (9) a long wooden bar counter with tankards."
        ),
        rows=3,
        cols=3,
        names=[
            "furniture-table", "furniture-chair", "furniture-bed",
            "furniture-wardrobe", "furniture-hearth", "furniture-rug",
            "furniture-barrels", "furniture-crates", "furniture-bar",
        ],
    ),
    # --- рынок: прилавки (9 шт., сетка 3x3) ---
    Task(
        name="market-stalls-3",
        description=(
            "Nine separate medieval market stalls seen from directly above (bird's eye), "
            "arranged in a three by three grid. Each stall is a wooden counter or cart with a "
            "canvas awning and goods laid out: (1) vegetables, (2) fruit, (3) bread and loaves, "
            "(4) sacks of grain, (5) meat cuts on a butcher's block, (6) pottery and clay jugs, "
            "(7) bolts of colorful fabric, (8) potion bottles and herbs, (9) blacksmith tools "
            "and wares."
        ),
        rows=3,
        cols=3,
        names=[
            "marketStallProduce", "marketStallFruit", "marketStallBread",
            "marketStallGrain", "marketStallMeat", "marketStallPottery",
            "marketStallFabric", "marketStallPotion", "marketStallTools",
        ],
    ),

    # --- рынок: дополнительный ассортимент (4 шт., сетка 2x2) ---
    Task(
        name="market-stalls-4",
        description=(
            "Four separate medieval market stalls seen from directly above (bird's eye), "
            "arranged in a two by two grid. Each stall is a wooden counter with canvas awning "
            "and goods laid out: (1) fresh fish on ice and in baskets, (2) wheels and wedges "
            "of cheese with a cutting board, (3) rolled and folded textiles with colorful "
            "bolts of cloth, (4) trays of honey cakes, pastries and dried fruit."
        ),
        rows=2,
        cols=2,
        names=["marketStallFish", "marketStallCheese", "marketStallTextiles", "marketStallSweets"],
    ),

    # --- деревья в едином стиле: заменяют бледные варианты oak.webp / oak-2.webp ---
    Task(
        name="trees-consistent",
        description=(
            "Two separate deciduous trees seen from directly above (bird's eye), "
            "arranged side by side in a two column grid. (1) a broad oak with dense "
            "saturated mid-green foliage, dark brown trunk and branches, warm shaded "
            "undersides; (2) a second deciduous tree with richer olive-green foliage "
            "and a slightly narrower crown. Both painted in the same hand-painted "
            "gouache battle-map style: painterly leaves, clear dark brown ink outline "
            "around every leaf cluster, NO white or light rim light, no glow, no "
            "backlight, no white bark. Flat pure white background."
        ),
        rows=1,
        cols=2,
        names=["oak", "oak-2"],
    ),

    # --- деревья в едином стиле, часть 2: заменяют бледные oak-3.webp / oak-4.webp ---
    Task(
        name="trees-consistent-2",
        description=(
            "Two separate deciduous trees seen from directly above (bird's eye), "
            "arranged side by side in a two column grid. (1) a maple-like tree with "
            "light yellow-green foliage and a warm olive tint, dense painterly leaves; "
            "(2) a wide deciduous tree with deep saturated green foliage and a rounded "
            "crown. Both in the same hand-painted gouache battle-map style: painterly "
            "leaves, clear dark brown ink outline around every leaf cluster, warm "
            "shaded undersides, NO white or light rim light, no glow, no backlight, "
            "no white bark. Flat pure white background."
        ),
        rows=2,
        cols=2,
        names=["oak-3", "oak-4", "oak-5", "oak-6"],
    ),

]

TASKS_TEXTURES: list[Task] = [
    Task("grass", "lush green meadow grass, short blades, tiny clover leaves, few fallen dry leaves scattered evenly",
         rows=1, cols=1, names=["grass"], seamless=True, overwrite=True),
    Task("earth", "packed brown earth and dirt with small pebbles and dry twigs scattered evenly",
         rows=1, cols=1, names=["earth"], seamless=True, overwrite=True),
    Task("bank", "sandy riverbank soil, damp light brown sand mixed with fine gravel",
         rows=1, cols=1, names=["bank"], seamless=True, overwrite=True),
    Task("water", "calm river water surface seen from above, small ripples and soft reflections, no foam line",
         rows=1, cols=1, names=["water"], seamless=True, overwrite=True),
    Task("flagstone", "grey stone flagstone floor of large square slabs with narrow joints and moss in cracks",
         rows=1, cols=1, names=["flagstone"], seamless=True, overwrite=True),
    Task("bedrock", "bare bedrock stone surface, rough grey granite with cracks and subtle striations",
         rows=1, cols=1, names=["bedrock"], seamless=True, overwrite=True),
    Task("snow", "fresh untrodden snow surface with soft small drifts and a few sparkles",
         rows=1, cols=1, names=["snow"], seamless=True, overwrite=True),
    Task("peat", "dark damp peat bog soil with moss patches and tiny puddles",
         rows=1, cols=1, names=["peat"], seamless=True, overwrite=True),
    Task("caveSoil", "cave floor soil, mixed brown earth and grit with small loose stones",
         rows=1, cols=1, names=["caveSoil"], seamless=True, overwrite=True),
    Task("dunes", "desert sand dunes texture seen from above, fine wind ripples in warm sand",
         rows=1, cols=1, names=["dunes"], seamless=True, overwrite=True),
    Task("hatching", "dense hand-drawn cross-hatching shading texture in ink, fine parallel lines",
         rows=1, cols=1, names=["hatching"], seamless=True, overwrite=True),
    Task("cobbles", "round cobblestone paving seen from above, small grey-brown stones set in earth",
         rows=1, cols=1, names=["cobbles"], seamless=True, overwrite=True),
    Task("thatch", "thatch roof surface seen from above, dry straw bundles layered in rows",
         rows=1, cols=1, names=["thatch"], seamless=True, overwrite=True),
    Task("shingles", "wooden shingle roof surface seen from above, overlapping weathered planks",
         rows=1, cols=1, names=["shingles"], seamless=True, overwrite=True),
    Task("terracotta", "terracotta clay roof tiles seen from above, warm orange curved tiles in rows",
         rows=1, cols=1, names=["terracotta"], seamless=True, overwrite=True),
    Task("slate", "dark slate roof tiles seen from above, blue-grey flat overlapping stone slabs",
         rows=1, cols=1, names=["slate"], seamless=True, overwrite=True),
]
# Общие настройки текстур: фон не трогаем (полотно должно быть квадратным),
# не обрезаем, ограничиваем 768 px и жмём webp с потерями, чтобы не раздувать бандл.
for _texture_task in TASKS_TEXTURES:
    _texture_task.remove_bg = False
    _texture_task.trim = False
    _texture_task.max_size = 768
    _texture_task.lossy = True


# ============================================================================
# 2. ВСПОМОГАТЕЛЬНОЕ: ЛОГИ, ПРОФИЛЬ, ОЖИДАНИЯ
# ============================================================================

LOG_DIR = RAW_OUTPUT_DIR.parent / "logs"


def _reconfigure_stdio() -> None:
    """Переводит вывод в UTF-8: консоль Windows может быть в cp1251 и падать на кириллице."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def setup_logging() -> logging.Logger:
    _reconfigure_stdio()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("gemini-sprites")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%H:%M:%S"))
    logger.addHandler(console)
    log_file = LOG_DIR / f"gemini-sprites-{datetime.now():%Y-%m-%d}.log"
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s"))
    logger.addHandler(file_handler)
    return logger


LOG = setup_logging()


# Папки профиля, которые не копируем: кэши бесполезны, а копируются долго.
SKIP_DIRS = {
    "cache2", "startupcache", "shader-cache", "thumbnails", "crashes",
    "minidumps", "datareporting", "saved-telemetry-pings",
}


def prepare_profile_dir(source: Path) -> Path:
    """Готовит рабочий профиль: копирует исходный и снимает блокировки.

    Firefox держит профиль занятым (файлы lock/.parentlock), а Playwright не
    умеет цепляться к работающему профилю. Поэтому по умолчанию делаем копию
    во временную папку и чистим кэши, чтобы копирование было быстрым.
    """
    if not source.exists():
        raise SystemExit(
            f"Не найден профиль Firefox: {source}\n"
            "Укажите корректный путь в FIREFOX_PROFILE_DIR (см. about:profiles в Firefox)."
        )
    if not COPY_PROFILE:
        remove_locks(source)
        return source

    target = Path(os.environ.get("TEMP", str(Path.home()))) / "gemini-bot-profile"
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)

    LOG.info("Копирую профиль Firefox → %s (это может занять 10-40 секунд)", target)
    skipped_files = 0
    try:
        # Копируем вручную: работающий Firefox держит parent.lock и часть
        # служебных файлов — их надо молча пропустить, а не падать.
        for root, dirs, files in os.walk(source):
            relative = os.path.relpath(root, source)
            destination = target if relative == "." else target / relative
            destination.mkdir(parents=True, exist_ok=True)
            dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
            for name in files:
                try:
                    shutil.copy2(os.path.join(root, name), destination / name)
                except (PermissionError, OSError):
                    skipped_files += 1
    except Exception as error:  # noqa: BLE001 — копирование не должно ронять прогон
        LOG.error("Не удалось скопировать профиль: %s", error)
        raise SystemExit(
            "Копирование профиля не удалось. Закройте Firefox и повторите запуск, "
            "либо укажите в FIREFOX_PROFILE_DIR другой, свободный профиль."
        )
    if skipped_files:
        LOG.info("Пропущено занятых файлов профиля: %d", skipped_files)
    remove_locks(target)
    if not (target / "cookies.sqlite").exists():
        LOG.warning(
            "В копии профиля нет cookies.sqlite — вход в Google может не сохраниться. "
            "Закройте Firefox и запустите скрипт ещё раз."
        )
    return target


def remove_locks(profile: Path) -> None:
    """Удаляет файлы блокировки профиля (только в копии!)."""
    for name in ("lock", ".parentlock", "parent.lock"):
        lock = profile / name
        try:
            if lock.exists() or lock.is_symlink():
                lock.unlink()
                LOG.info("Снят lock профиля: %s", name)
        except OSError:
            pass


def launch_browser(playwright, profile: Path, headless: bool):
    """Запускает Firefox с указанным профилем и возвращает контекст."""
    # Настройки, которые уменьшают «шумиху» первого запуска и отключают
    # лишние проверки совместимости при копии профиля.
    prefs = {
        "browser.startup.homepage_override.mstone": "ignore",
        "browser.aboutwelcome.enabled": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "toolkit.telemetry.enabled": False,
        "app.update.enabled": False,
        "browser.shell.checkDefaultBrowser": False,
        "signon.rememberSignons": True,
        "intl.accept_languages": "ru-RU,ru,en-US,en",
    }
    env = {**os.environ, "MOZ_ALLOW_DOWNGRADE": "1", "MOZ_CRASHREPORTER_DISABLE": "1"}
    context = playwright.firefox.launch_persistent_context(
        user_data_dir=str(profile),
        headless=headless,
        viewport={"width": 1440, "height": 950},
        accept_downloads=True,
        locale="ru-RU",
        firefox_user_prefs=prefs,
        env=env,
    )
    context.set_default_timeout(30_000)
    return context


# ============================================================================
# 3. GEMINI: ОТПРАВКА ПРОМТА, ОЖИДАНИЕ, СКАЧИВАНИЕ
# ============================================================================

# Селекторы собраны из текущей (на момент написания) верстки Gemini.
# Если Google обновит интерфейс — правится в одном месте (см. инструкцию в конце).
SEL_COMPOSER = (
    'rich-textarea div[contenteditable="true"], '
    'div[contenteditable="true"][role="textbox"], '
    'textarea[aria-label]'
)
SEL_STOP = 'button[aria-label*="Stop"], button[aria-label*="Остановить"], button[aria-label*="остановить"]'
SEL_RESPONSE = "model-response"
SEL_DOWNLOAD = (
    'button[aria-label*="Download"], button[aria-label*="Скачать"], '
    '[data-test-id="download-button"], button[aria-label*="download"]'
)


class ImageCapture:
    """Перехватывает сетевые ответы с картинками — надёжный путь к оригиналу.

    Кнопка Download в интерфейсе Gemini меняется от версии к версии, а картинка
    всегда приходит отдельным сетевым ответом. Мы запоминаем такие ответы и позже
    пробуем забрать их байты: сначала из тела ответа, затем повторным GET по URL
    (сессионные куки берутся из контекста браузера).
    """

    def __init__(self, min_bytes: int = 40_000, min_side: int = 512) -> None:
        self.min_bytes = min_bytes
        self.min_side = min_side  # отсекаем логотип/иконки Gemini по размеру
        self.responses: list = []
        self.chunks: list[tuple[int, bytes]] = []  # (площадь, байты)
        self.enabled = False

    def reset(self) -> None:
        self.responses.clear()
        self.chunks.clear()
        self.enabled = True

    def handle(self, response) -> None:  # noqa: ANN001 — объект Response из Playwright
        if not self.enabled:
            return
        try:
            headers = response.headers or {}
            ctype = str(headers.get("content-type", ""))
            if not ctype.startswith("image/"):
                return
            url = (response.url or "")
            low = url.lower()
            if "googleusercontent" not in low and "gemini" not in low:
                return
            # Логотип-«искра» и прочие UI-иконки приходят с тех же доменов.
            if any(bad in low for bad in ("sparkle", "logo", "favicon", "avatar", "gstatic", "icon")):
                return
            self.responses.append(response)
        except Exception:
            pass

    def collect(self, request_context=None) -> None:
        """Забирает байты запомненных ответов (вызывать после генерации)."""
        for response in self.responses:
            try:
                body = response.body()
            except Exception:
                body = None
            if not body and request_context is not None:
                try:
                    body = request_context.get(response.url).body()
                except Exception:
                    body = None
            if not body or len(body) < self.min_bytes:
                continue
            size = _image_size(body)
            # Иконки Gemini (например, разноцветная «искра» 512x512) отбрасываем:
            # настоящий лист приходит крупнее и почти всегда квадратный.
            if size is None or min(size) < self.min_side:
                continue
            self.chunks.append((size[0] * size[1], body))
        # Дубликаты не нужны: один и тот же URL может встретиться дважды.
        seen: set[int] = set()
        chunks: list[tuple[int, bytes]] = []
        for area, body in self.chunks:
            if hash(body) in seen:
                continue
            seen.add(hash(body))
            chunks.append((area, body))
        self.chunks = sorted(chunks, key=lambda item: item[0], reverse=True)

    def best(self) -> bytes | None:
        return self.chunks[0][1] if self.chunks else None


def _image_size(body: bytes) -> tuple[int, int] | None:
    """Размер картинки по байтам — нужен, чтобы не перепутать лист с иконкой."""
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(body)) as probe:
            return probe.size
    except Exception:
        return None

def save_captured(capture: ImageCapture, target: Path) -> Path | None:
    """Сохраняет самую крупную перехваченную картинку (с правильным расширением)."""
    body = capture.best()
    if not body:
        return None
    from io import BytesIO

    from PIL import Image

    # Gemini отдаёт не всегда PNG (чаще JPEG/WebP) — определяем формат по байтам,
    # иначе Pillow/slicer потом путаются в расширении.
    extension = target.suffix
    try:
        with Image.open(BytesIO(body)) as probe:
            fmt = (probe.format or "").lower()
        mapping = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}
        extension = mapping.get(fmt, extension)
    except Exception:
        pass
    actual = target.with_suffix(extension)
    actual.parent.mkdir(parents=True, exist_ok=True)
    actual.write_bytes(body)
    LOG.info("Сохранено из сетевого ответа (%d КБ) → %s", len(body) // 1024, actual.name)
    return actual

def open_fresh_chat(page) -> None:
    """Открывает новую сессию Gemini, чтобы контекст не смешивался."""
    page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_timeout(2_500)
    # Иногда Gemini переспрашивает про новый чат — закрываем баннеры, если они есть.
    for selector in ('button:has-text("Понятно")', 'button:has-text("Got it")', 'button[aria-label*="Close"]'):
        try:
            button = page.locator(selector).first
            if button.is_visible(timeout=1_000):
                button.click(timeout=2_000)
        except Exception:
            pass


def composer_locator(page):
    return page.locator(SEL_COMPOSER).first


def send_prompt(page, prompt: str) -> None:
    """Печатает промт в поле ввода и отправляет его.

    Клик по полю иногда перехватывают невидимые оверлеи Gemini, поэтому пробуем
    несколько стратегий: force-click, программный focus() и вставку с клавиатуры.
    """
    composer = composer_locator(page)
    composer.wait_for(state="attached", timeout=60_000)
    for attempt in range(3):
        try:
            composer.click(force=True, timeout=5_000)
        except Exception:
            try:
                composer.focus(timeout=5_000)
            except Exception:
                pass
        page.wait_for_timeout(300)
        if attempt == 0:
            try:
                composer.fill(prompt)
            except Exception:
                pass
        if not (composer.inner_text() or "").strip():
            page.keyboard.insert_text(prompt)
        if (composer.inner_text() or "").strip():
            break
    else:
        raise RuntimeError("Не удалось ввести промт в поле Gemini (поле осталось пустым)")

    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    # Если текст остался в поле — отправка не прошла, жмём кнопку отправки.
    page.wait_for_timeout(1_200)
    if (composer.inner_text() or "").strip():
        try:
            page.locator(
                'button[aria-label*="Отправить"], button[aria-label*="Send"], button.send-button'
            ).last.click(timeout=5_000)
        except Exception:
            LOG.warning("Текст остался в поле, кнопка отправки не найдена")
    LOG.info("Промт отправлен (%d символов)", len(prompt))


def wait_for_answer(page, timeout_s: int = 240) -> None:
    """Ждёт, пока Gemini сгенерирует ответ: Stop появился и исчез."""
    stop = page.locator(SEL_STOP)
    appeared = False
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            if stop.count() and stop.first.is_visible(timeout=500):
                appeared = True
                break
        except Exception:
            pass
        page.wait_for_timeout(500)
    if appeared:
        LOG.info("Генерация началась, ждём завершения…")
    else:
        LOG.info("Кнопка Stop не появилась — ждём появления ответа.")

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            visible = stop.count() > 0 and stop.first.is_visible(timeout=500)
        except Exception:
            visible = False
        if appeared and not visible:
            break
        page.wait_for_timeout(800)
    page.wait_for_timeout(int(RENDER_WAIT * 1000))


def find_last_image(page):
    """Находит последнюю сгенерированную картинку в ответе модели."""
    responses = page.locator(SEL_RESPONSE)
    if responses.count():
        last = responses.nth(count := responses.count() - 1)
        images = last.locator("img")
        if images.count():
            for index in range(images.count() - 1, -1, -1):
                image = images.nth(index)
                try:
                    box = image.bounding_box()
                    if box and box["width"] >= 200 and box["height"] >= 200:
                        return image
                except Exception:
                    continue
    # Иногда картинка лежит вне model-response (например, в диалоговом превью).
    images = page.locator("img")
    best = None
    best_area = 0.0
    for index in range(images.count()):
        image = images.nth(index)
        try:
            box = image.bounding_box()
        except Exception:
            continue
        if box and box["width"] >= 200 and box["height"] >= 200:
            area = box["width"] * box["height"]
            if area > best_area:
                best, best_area = image, area
    return best


def dump_dom(page, task_name: str) -> None:
    """Сохраняет HTML последнего ответа — по нему видно, как сейчас устроена разметка."""
    try:
        responses = page.locator(SEL_RESPONSE)
        if not responses.count():
            LOG.warning("[%s] model-response не найден для дампа DOM", task_name)
            return
        html = responses.nth(responses.count() - 1).inner_html()
        target = RAW_OUTPUT_DIR / f"_dom-{task_name}.html"
        target.write_text(html, encoding="utf-8")
        LOG.info("DOM последнего ответа сохранён: %s (%d символов)", target, len(html))
    except Exception as error:
        LOG.warning("Не удалось сохранить DOM: %s", error)


def save_via_download(page, image, target: Path) -> bool:
    """Пытается скачать картинку штатной кнопкой (hover → Download)."""
    try:
        image.hover()
        page.wait_for_timeout(1_200)
        button = page.locator(SEL_DOWNLOAD).last
        button.wait_for(state="visible", timeout=8_000)
        with page.expect_download(timeout=60_000) as download_info:
            button.click()
        download = download_info.value
        target.parent.mkdir(parents=True, exist_ok=True)
        download.save_as(str(target))
        LOG.info("Скачано кнопкой Download → %s", target.name)
        return True
    except Exception as error:
        LOG.warning("Штатное скачивание не сработало: %s", str(error).splitlines()[0])
        return False


def save_via_dom(page, image, target: Path) -> bool:
    """Запасной путь: достаёт байты картинки прямо из DOM (blob/data/https)."""
    try:
        src = image.get_attribute("src") or ""
        if src.startswith("data:"):
            payload = src.split(",", 1)[1]
            target.write_bytes(base64.b64decode(payload))
            LOG.info("Сохранено из data-URL → %s", target.name)
            return True
        if src.startswith("blob:") or src.startswith("http"):
            result = page.evaluate(
                """async (url) => {
                    const response = await fetch(url);
                    const buffer = await response.arrayBuffer();
                    let binary = '';
                    const bytes = new Uint8Array(buffer);
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    return btoa(binary);
                }""",
                src,
            )
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base64.b64decode(result))
            LOG.info("Сохранено через fetch(%s…) → %s", src[:40], target.name)
            return True
    except Exception as error:
        LOG.warning("Не удалось вытащить картинку из DOM: %s", str(error).splitlines()[0])
    return False


def build_prompt(task: Task) -> str:
    """Склеивает промт: для объектов — стиль + описание + негатив,
    для текстур — текстурный стиль + правила бесшовности + негатив."""
    if task.seamless:
        return f"{TEXTURE_STYLE}\n\n{SEAMLESS_RULES}\n\n{task.description}\n\n{TEXTURE_NEGATIVE}"
    return f"{STYLE_BLOCK}\n\n{task.description}\n\n{NEGATIVE_BLOCK}"


def wait_for_ready_image(page, capture: ImageCapture, timeout: float = 150.0) -> bool:
    """Ждёт, пока Gemini реально нарисует картинку.

    Кнопка Stop исчезает, когда закончился ТЕКСТ, а изображение может ещё
    грузиться (в интерфейсе виден тёмный плейсхолдер). Поэтому дополнительно
    ждём либо перехваченный сетевой ответ с крупной картинкой, либо <img>
    с naturalWidth >= 512 в последнем ответе модели.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            capture.collect(page.request)
            if capture.best():
                return True
        except Exception:
            pass
        try:
            ready = page.evaluate(
                """() => {
                    const msgs = document.querySelectorAll('model-response');
                    const last = msgs[msgs.length - 1] || document;
                    return Array.from(last.querySelectorAll('img'))
                        .some(img => img.naturalWidth >= 512 && img.naturalHeight >= 512);
                }"""
            )
            if ready:
                page.wait_for_timeout(1_500)
                return True
        except Exception:
            pass
        page.wait_for_timeout(1_500)
    return False


def _existing_raw(raw_dir: Path, name: str) -> Path | None:
    """Ищет уже скачанный лист с любым расширением (Gemini отдаёт jpeg/webp)."""
    for suffix in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        candidate = raw_dir / f"{name}{suffix}"
        if candidate.exists():
            return candidate
    return None

def generate_sheet(page, task: Task, raw_dir: Path, capture: ImageCapture, force: bool) -> Path | None:
    """Полный цикл по одному заданию: чат → промт → ожидание → скачивание."""
    raw_path = raw_dir / f"{task.name}.png"
    existing = _existing_raw(raw_dir, task.name)
    if existing is not None and not force:
        LOG.info("[%s] лист уже есть (%s), пропускаю (--force чтобы перегенерировать)", task.name, existing.name)
        return existing

    open_fresh_chat(page)
    prompt = build_prompt(task)
    capture.reset()
    send_prompt(page, prompt)
    wait_for_answer(page)
    page.wait_for_timeout(1_500)
    wait_for_ready_image(page, capture)

    raw_dir.mkdir(parents=True, exist_ok=True)
    # Собираем байты перехваченных сетевых ответов (обычно это и есть оригинал).
    capture.collect(page.request)
    captured = save_captured(capture, raw_path)
    if captured:
        capture.enabled = False
        return captured

    image = find_last_image(page)
    if image is None:
        LOG.error("[%s] картинка не найдена: возможно, сработал фильтр или ответ не дождались", task.name)
        dump_dom(page, task.name)
        try:
            page.screenshot(path=str(RAW_OUTPUT_DIR / f"_error-{task.name}.png"), full_page=True)
        except Exception:
            pass
        capture.enabled = False
        return None

    # Способ 2: штатная кнопка Download (в т.ч. через превью-лайтбокс).
    if save_via_download(page, image, raw_path):
        capture.enabled = False
        return raw_path
    # Способ 3: байты напрямую из DOM.
    if save_via_dom(page, image, raw_path):
        capture.enabled = False
        return raw_path
    # Способ 4: картинка уже отрисована — снимаем её со страницы как есть.
    try:
        image.screenshot(path=str(raw_path))
        LOG.info("Сохранено скриншотом элемента → %s", raw_path.name)
        capture.enabled = False
        return raw_path
    except Exception as error:
        LOG.warning("Скриншот элемента не удался: %s", str(error).splitlines()[0])
    # Способ 5: повторно пробуем перехват (картинка могла догрузиться позже).
    page.wait_for_timeout(3_000)
    capture.collect(page.request)
    captured = save_captured(capture, raw_path)
    if captured:
        capture.enabled = False
        return captured
    dump_dom(page, task.name)
    try:
        page.screenshot(path=str(RAW_OUTPUT_DIR / f"_error-{task.name}.png"), full_page=True)
    except Exception:
        pass
    LOG.error("[%s] не удалось скачать картинку ни одним способом", task.name)
    capture.enabled = False
    return None


# ============================================================================
# 4. ПОСТОБРАБОТКА: НАРЕЗКА, ФОН, ИМЕНА, УСТАНОВКА
# ============================================================================

try:  # rembg подключаем лениво: без него скрипт работает, просто вырезает белый
    from rembg import remove as rembg_remove  # type: ignore

    REMBG_AVAILABLE = True
except Exception:
    REMBG_AVAILABLE = False


def strip_background(tile) -> "Image.Image":
    """Убирает однотонный фон.

    По умолчанию — быстрый алгоритм: пиксели, близкие к белому, становятся
    прозрачными (это ровно наш стиль «объекты на белом фоне»). Если установлен
    rembg и USE_REMBG=True — используется нейросетевой сегментатор.
    """
    from PIL import Image

    if USE_REMBG and REMBG_AVAILABLE:
        return rembg_remove(tile.convert("RGBA"))

    from PIL import Image, ImageChops

    tile = tile.convert("RGBA")
    threshold = 246
    red, green, blue, alpha = tile.split()
    # min(r, g, b) >= threshold  ⇔  «почти белый»
    darkest = ImageChops.darker(red, ImageChops.darker(green, blue))
    # 255 — оставить пиксель, 0 — сделать прозрачным
    mask = darkest.point(lambda value: 0 if value >= threshold else 255)
    # Сохраняем исходную альфу: итоговая = min(исходная, маска)
    alpha = ImageChops.darker(alpha, mask)
    tile.putalpha(alpha)
    return tile


def trim_tile(tile) -> "Image.Image":
    """Обрезает прозрачные поля вокруг непрозрачного содержимого."""
    bbox = tile.getbbox()
    if not bbox:
        return tile
    left, top, right, bottom = bbox
    left = max(0, left - PADDING)
    top = max(0, top - PADDING)
    right = min(tile.width, right + PADDING)
    bottom = min(tile.height, bottom + PADDING)
    return tile.crop((left, top, right, bottom))


def limit_size(tile):
    from PIL import Image

    if MAX_SPRITE_SIZE and max(tile.size) > MAX_SPRITE_SIZE:
        scale = MAX_SPRITE_SIZE / max(tile.size)
        size = (max(1, round(tile.width * scale)), max(1, round(tile.height * scale)))
        tile = tile.resize(size, Image.LANCZOS)
    return tile


def unique_target(name: str, folder: Path, extension: str) -> Path:
    """Свободное имя с авто-суффиксом варианта: rock -> rock-2 -> rock-3."""
    path = folder / f"{name}.{extension}"
    if not path.exists():
        return path
    index = 2
    while True:
        candidate = folder / f"{name}-{index}.{extension}"
        if not candidate.exists():
            return candidate
        index += 1


# Сюда складываем прежние версии текстур перед заменой (на случай отката).
BACKUP_DIR = RAW_OUTPUT_DIR.parent / "backup-materials"


def seam_score(image) -> float:
    """Оценка шва: 0 — края идеально стыкуются, >0.06 — заметный разрыв."""
    from PIL import ImageChops, ImageStat

    rgb = image.convert("RGB")
    width, height = rgb.size

    def diff(first, second) -> float:
        stat = ImageStat.Stat(ImageChops.difference(first, second))
        return sum(stat.mean) / (3 * 255)

    horizontal = diff(rgb.crop((0, 0, 1, height)), rgb.crop((width - 1, 0, width, height)))
    vertical = diff(rgb.crop((0, 0, width, 1)), rgb.crop((0, height - 1, width, height)))
    return max(horizontal, vertical)


def make_seamless(image, band_ratio: float = 0.05):
    """Делает края строго стыкуемыми.

    Крайние полосы слева/справа (и сверху/снизу) плавно смешиваются к среднему
    между противоположными краями, поэтому левый столбец становится побитово
    равен правому, а верхняя строка — нижней. Тонкая полоса у краёв может
    слегка «замылиться», но шов исчезает полностью.
    """
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    band = max(4, int(min(width, height) * band_ratio))

    # Горизонталь: средний цвет пары «левый/правый» пиксель.
    average = [
        tuple((pixels[0, y][c] + pixels[width - 1, y][c]) // 2 for c in range(4))
        for y in range(height)
    ]
    for offset in range(band):
        alpha = 1.0 - offset / band
        for y in range(height):
            left = pixels[offset, y]
            right = pixels[width - 1 - offset, y]
            target = average[y]
            pixels[offset, y] = tuple(round(left[c] * (1 - alpha) + target[c] * alpha) for c in range(4))
            pixels[width - 1 - offset, y] = tuple(
                round(right[c] * (1 - alpha) + target[c] * alpha) for c in range(4)
            )

    # Вертикаль — уже по обработанным столбцам.
    average = [
        tuple((pixels[x, 0][c] + pixels[x, height - 1][c]) // 2 for c in range(4))
        for x in range(width)
    ]
    for offset in range(band):
        alpha = 1.0 - offset / band
        for x in range(width):
            top = pixels[x, offset]
            bottom = pixels[x, height - 1 - offset]
            target = average[x]
            pixels[x, offset] = tuple(round(top[c] * (1 - alpha) + target[c] * alpha) for c in range(4))
            pixels[x, height - 1 - offset] = tuple(
                round(bottom[c] * (1 - alpha) + target[c] * alpha) for c in range(4)
            )
    return image


def backup_material(target: Path) -> None:
    """Сохраняет прежнюю версию материала, если бэкапа ещё нет."""
    if not target.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / target.name
    if not backup.exists():
        shutil.copy2(target, backup)
        LOG.info("  бэкап прежней версии: %s", backup.name)


def postprocess(raw_path: Path, task: Task) -> list[Path]:
    """Режет лист на тайлы и ставит их в папку проекта."""
    from PIL import Image

    FINAL_SPRITES_DIR.mkdir(parents=True, exist_ok=True)
    image = Image.open(raw_path).convert("RGBA")
    width, height = image.size
    cell_w, cell_h = width / task.cols, height / task.rows

    remove_bg = REMOVE_BG if task.remove_bg is None else task.remove_bg
    trim = TRIM if task.trim is None else task.trim
    max_size = MAX_SPRITE_SIZE if task.max_size is None else task.max_size

    written: list[Path] = []
    index = 0
    for row in range(task.rows):
        for col in range(task.cols):
            index += 1
            box = (
                round(col * cell_w), round(row * cell_h),
                round((col + 1) * cell_w), round((row + 1) * cell_h),
            )
            tile = image.crop(box)
            if task.seamless:
                before = seam_score(tile)
                tile = make_seamless(tile)
                after = seam_score(tile)
                LOG.info("  шов: %.4f -> %.4f (0 = идеально)", before, after)
            if remove_bg:
                tile = strip_background(tile)
            if trim:
                tile = trim_tile(tile)
            if max_size:
                from PIL import Image as _Image

                if max(tile.size) > max_size:
                    scale = max_size / max(tile.size)
                    tile = tile.resize(
                        (max(1, round(tile.width * scale)), max(1, round(tile.height * scale))),
                        _Image.LANCZOS,
                    )

            name = task.names[index - 1] if index - 1 < len(task.names) else f"{task.name}_{index:02d}"
            extension = FINAL_FORMAT.lower()
            if task.overwrite:
                target = FINAL_SPRITES_DIR / f"{name}.{extension}"
                backup_material(target)
            else:
                target = unique_target(name, FINAL_SPRITES_DIR, extension)
            if extension == "webp":
                if task.lossy:
                    tile.save(target, "WEBP", quality=WEBP_QUALITY, method=6)
                else:
                    tile.save(target, "WEBP", lossless=True, quality=100, method=6)
            else:
                tile.save(target, "PNG")
            written.append(target)
            LOG.info("  спрайт %s -> %s (%dx%d)", name, target.name, tile.width, tile.height)
    return written


TASKS_TEXTURES.append(
    Task(
        name="waterDeep",
        description=(
            "Deep, calm lake water seen from directly above: dark teal-blue depth with "
            "faint submerged shadows, very soft caustics and no foam at all."
        ),
        rows=1, cols=1, names=["waterDeep"],
        seamless=True, overwrite=True,
        remove_bg=False, trim=False, max_size=768, lossy=True,
    )
)
TASKS_TEXTURES.append(
    Task(
        name="waterRapids",
        description=(
            "Fast flowing mountain stream seen from directly above: turquoise water with "
            "white rapids, foam streaks and small whirls, strong directional flow along "
            "the horizontal axis."
        ),
        rows=1, cols=1, names=["waterRapids"],
        seamless=True, overwrite=True,
        remove_bg=False, trim=False, max_size=768, lossy=True,
    )
)

# ============================================================================
# 5. РЕЖИМЫ ЗАПУСКА
# ============================================================================

def mode_dry_run(tasks: list[Task]) -> None:
    print(f"Листов: {len(tasks)}")
    print(f"Профиль: {FIREFOX_PROFILE_DIR}")
    print(f"Исходники: {RAW_OUTPUT_DIR}")
    print(f"Спрайты: {FINAL_SPRITES_DIR} (формат {FINAL_FORMAT})")
    for task in tasks:
        names = ", ".join(task.names) if task.names else f"{task.name}_01…"
        print(f"\n[{task.name}] сетка {task.rows}x{task.cols} -> {names}")
        print("  ", task.description[:300])


def mode_check(tasks: list[Task], headless: bool) -> None:
    """Проверка окружения: профиль, браузер, вход в Google, поле ввода."""
    from playwright.sync_api import sync_playwright

    profile = prepare_profile_dir(FIREFOX_PROFILE_DIR)
    with sync_playwright() as playwright:
        context = launch_browser(playwright, profile, headless)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_timeout(4_000)
        composer = composer_locator(page)
        has_composer = composer.count() > 0 and composer.first.is_visible()
        text = page.inner_text("body").lower()
        logged_in = has_composer and "войти" not in text[:600]
        print(f"Профиль: {profile}")
        print(f"URL страницы: {page.url}")
        print(f"Поле ввода найдено: {has_composer}")
        print(f"Похоже, вход выполнен: {logged_in}")
        shots = RAW_OUTPUT_DIR.parent / "check-gemini.png"
        shots.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(shots), full_page=False)
        print(f"Скриншот: {shots}")
        context.close()


def mode_generate(tasks: list[Task], headless: bool, force: bool) -> None:
    from playwright.sync_api import sync_playwright

    RAW_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    profile = prepare_profile_dir(FIREFOX_PROFILE_DIR)
    capture = ImageCapture()
    with sync_playwright() as playwright:
        context = launch_browser(playwright, profile, headless)
        page = context.pages[0] if context.pages else context.new_page()
        page.on("response", capture.handle)
        for number, task in enumerate(tasks, 1):
            LOG.info("=== [%d/%d] %s ===", number, len(tasks), task.name)
            try:
                existing = None if force else _existing_raw(RAW_OUTPUT_DIR, task.name)
                if existing is not None:
                    LOG.info("[%s] лист уже есть (%s), пропускаю без повторной нарезки", task.name, existing.name)
                else:
                    raw = generate_sheet(page, task, RAW_OUTPUT_DIR, capture, force)
                    if raw is None:
                        LOG.error("[%s] пропущено из-за ошибки", task.name)
                    else:
                        written = postprocess(raw, task)
                        LOG.info("[%s] готово, спрайтов: %d", task.name, len(written))
            except Exception as error:
                LOG.exception("[%s] исключение: %s", task.name, error)
            if number < len(tasks):
                LOG.info("Пауза %d сек перед следующим листом…", DELAY_BETWEEN_TASKS)
                time.sleep(DELAY_BETWEEN_TASKS)
        context.close()
    LOG.info("Готово. Не забудьте пересобрать генератор: npm run build")



def mode_reslice(quality: int, max_size: int | None, only: str) -> None:
    """Повторно режет уже скачанные листы из RAW, без обращения к браузеру.

    Нужен, когда надо поднять качество/разрешение спрайтов: сырьё лежит в
    assets/source/generated/web, поэтому генерацию заново платить не надо.
    """
    from dataclasses import replace

    global WEBP_QUALITY
    WEBP_QUALITY = quality
    total = 0
    for task in TASKS:
        if only and task.name != only:
            continue
        raw = _existing_raw(RAW_OUTPUT_DIR, task.name)
        if raw is None:
            LOG.warning("[%s] сырьё не найдено, пропуск", task.name)
            continue
        patched = replace(
            task,
            overwrite=True,
            lossy=True,
            max_size=max_size if max_size else task.max_size,
        )
        LOG.info("=== [%s] %s", task.name, raw.name)
        total += len(postprocess(raw, patched))
    LOG.info("Готово, спрайтов пересобрано: %d", total)

def main() -> None:
    parser = argparse.ArgumentParser(description="Генерация спрайтов и текстур через веб-интерфейс Gemini")
    parser.add_argument("--only", default="", help="имя одного задания (например, rocks-2 или grass)")
    parser.add_argument("--all", action="store_true", help="все задания выбранного набора")
    parser.add_argument("--textures", action="store_true", help="набор бесшовных текстур земли")
    parser.add_argument("--force", action="store_true", help="перегенерировать готовые листы")
    parser.add_argument("--headless", action="store_true", help="без окна браузера (после первого входа)")
    parser.add_argument("--check", action="store_true", help="проверить профиль/вход/селекторы")
    parser.add_argument("--dry-run", action="store_true", help="показать план без запуска браузера")
    parser.add_argument("--list", action="store_true", help="вывести список заданий и выйти")
    parser.add_argument("--reslice", action="store_true", help="пересобрать спрайты из скачанного сырья")
    parser.add_argument("--quality", type=int, default=95, help="качество WebP для --reslice")
    parser.add_argument("--max-size", type=int, default=0, help="ограничение размера тайла для --reslice (0 = как в задании)")
    args = parser.parse_args()

    if args.list:
        for task in TASKS + TASKS_TEXTURES:
            kind = "текстура" if task.seamless else "лист"
            print(f"{task.name:16} {kind:9} {task.rows}x{task.cols} -> {', '.join(task.names)}")
        return

    if args.only:
        tasks = [task for task in TASKS + TASKS_TEXTURES if task.name == args.only]
        if not tasks:
            raise SystemExit(f"Нет задания с именем {args.only}. Запустите --list, чтобы увидеть список.")
    elif args.all:
        tasks = list(TASKS_TEXTURES if args.textures else TASKS)
    elif args.check:
        tasks = list(TASKS_TEXTURES if args.textures else TASKS)
    else:
        raise SystemExit("Укажите --only <имя>, --all [--textures], --check, --list или --dry-run")

    if args.reslice:
        mode_reslice(args.quality, args.max_size or None, args.only)
        return
    if args.dry_run:
        mode_dry_run(tasks)
        return
    if args.check:
        mode_check(tasks, args.headless)
        return
    mode_generate(tasks, args.headless, args.force)

if __name__ == "__main__":
    main()
