#!/usr/bin/env python3
"""Автогенерация спрайт-листов через Google Gemini / Imagen API.

Что делает:
  1. берёт промты из scripts/sprite-prompts.json (общий стиль + лист);
  2. отправляет их в API и скачивает PNG-лист в assets/source/generated/;
  3. нарезает лист скриптом slice-sheet.py с нужными именами;
  4. по флагу --install ставит результат в src/assets/cartography.

Ключ берётся из переменной окружения GEMINI_API_KEY (или GOOGLE_API_KEY),
либо из файла .env рядом с корнем проекта.

Примеры:
  python scripts/generate-sprites.py --dry-run                 # показать, что будет сделано
  python scripts/generate-sprites.py --only rocks-2            # один лист
  python scripts/generate-sprites.py --all --install           # все листы + установка
  python scripts/generate-sprites.py --all --model imagen-4.0-generate-001
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "scripts" / "sprite-prompts.json"
GENERATED = ROOT / "assets" / "source" / "generated"
ASSETS = ROOT / "src" / "assets" / "cartography"
SLICER = ROOT / "scripts" / "slice-sheet.py"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_MODEL = "gemini-2.5-flash-image"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


def load_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key.strip()
    for env_file in (ROOT / ".env", ROOT.parent / ".env"):
        if env_file.exists():
            for line in env_file.read_text("utf-8", errors="replace").splitlines():
                line = line.strip()
                if line.startswith(("GEMINI_API_KEY", "GOOGLE_API_KEY")) and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "Нет ключа. Положите GEMINI_API_KEY=... в .env проекта или задайте переменную окружения.\n"
        "Ключ: https://aistudio.google.com/apikey"
    )


def build_prompt(data: dict, sheet: dict) -> str:
    return f"{data['style']} {sheet['prompt']}\n\nAvoid: {data['negative']}"


def generate(model: str, key: str, prompt: str, retries: int = 3) -> bytes:
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        # Просим квадратную картинку: для спрайт-листа это важно.
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}},
    }).encode("utf-8")
    url = ENDPOINT.format(model=model, key=key)
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
            for candidate in payload.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    inline = part.get("inlineData") or part.get("inline_data")
                    if inline and inline.get("data"):
                        return base64.b64decode(inline["data"])
            raise RuntimeError(f"В ответе нет картинки: {json.dumps(payload)[:400]}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:400]
            last = RuntimeError(f"HTTP {error.code}: {detail}")
            if error.code in (429, 500, 503) and attempt < retries:
                time.sleep(4 * attempt)
                continue
            raise last from None
        except (urllib.error.URLError, TimeoutError) as error:
            last = RuntimeError(f"Сеть: {error}")
            if attempt < retries:
                time.sleep(4 * attempt)
                continue
            raise last from None
    raise last or RuntimeError("Не удалось получить картинку")


def slice_sheet(sheet: dict, sheet_path: Path, out_dir: Path, install: bool) -> int:
    target = ASSETS if install else out_dir
    args = [
        sys.executable, str(SLICER), str(sheet_path), "-o", str(target),
        "--mode", sheet.get("mode", "quad"),
        "--names", ",".join(sheet["names"]),
        "--lossy", "--max-size", str(sheet.get("maxSize", 400)),
    ]
    if sheet.get("minArea"):
        args += ["--min-area", str(sheet["minArea"])]
    if sheet.get("rows"):
        args += ["--rows", str(sheet["rows"]), "--cols", str(sheet["cols"])]
    result = subprocess.run(args, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    if result.returncode:
        sys.stderr.write(result.stderr)
    return result.returncode


def main() -> None:
    parser = argparse.ArgumentParser(description="Генерация спрайт-листов через Gemini API")
    parser.add_argument("--only", default="", help="имя одного листа из sprite-prompts.json")
    parser.add_argument("--all", action="store_true", help="сгенерировать все листы")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--install", action="store_true", help="сразу ставить в src/assets/cartography")
    parser.add_argument("--dry-run", action="store_true", help="только показать план")
    parser.add_argument("--force", action="store_true", help="перегенерировать даже готовые листы")
    args = parser.parse_args()

    data = json.loads(PROMPTS.read_text("utf-8"))
    sheets = data["sheets"]
    if args.only:
        sheets = [sheet for sheet in sheets if sheet["name"] == args.only]
        if not sheets:
            raise SystemExit(f"Нет листа с именем {args.only}")
    elif not args.all:
        raise SystemExit("Укажите --only <имя> или --all (или --dry-run для плана)")

    GENERATED.mkdir(parents=True, exist_ok=True)
    print(f"Модель: {args.model} · листов: {len(sheets)} · установка: {args.install}")
    if args.dry_run:
        for sheet in sheets:
            print(f"\n[{sheet['name']}] mode={sheet.get('mode', 'quad')} → {', '.join(sheet['names'])}")
            print(build_prompt(data, sheet)[:600] + "…")
        return

    key = load_key()
    for index, sheet in enumerate(sheets, 1):
        sheet_path = GENERATED / f"{sheet['name']}.png"
        print(f"\n[{index}/{len(sheets)}] {sheet['name']} → {sheet_path}")
        if sheet_path.exists() and not args.force:
            print("  уже есть, пропускаю (--force чтобы перегенерировать)")
        else:
            try:
                image = generate(args.model, key, build_prompt(data, sheet))
            except RuntimeError as error:
                print(f"  ОШИБКА: {error}")
                continue
            sheet_path.write_bytes(image)
            print(f"  получено {len(image) // 1024} КБ")
        code = slice_sheet(sheet, sheet_path, GENERATED / "sliced", args.install)
        print(f"  нарезка: {'ok' if code == 0 else 'ошибка'}")

    if args.install:
        print("\nГотово. Дальше: tsc/build/deploy (см. docs/ART-PIPELINE.md)")


if __name__ == "__main__":
    main()
