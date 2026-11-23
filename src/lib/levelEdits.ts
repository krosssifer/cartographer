import type { GenSettings, MapData } from './types';

/**
 * Ручные правки уровней многоуровневого подземелья в пределах сеанса.
 * Ключ — настройки генерации без номера уровня: пока они не меняются, переход
 * между уровнями возвращает отредактированную карту; любая другая правка
 * настроек (seed, архетип, размер, число уровней) хранилище сбрасывает.
 * Формат проекта не меняется: в файл по-прежнему пишется текущий уровень.
 */
export interface LevelEdits { key: string; maps: Readonly<Record<number, MapData>> }

export const EMPTY_LEVEL_EDITS: LevelEdits = { key: '', maps: {} };

export function levelKey(gen: GenSettings): string {
  const { dungeonLevel: _level, ...rest } = gen;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** Изменение настроек — это только переход на другой уровень того же подземелья. */
export function isLevelSwitch(gen: GenSettings, patch: Partial<GenSettings>): boolean {
  const keys = Object.keys(patch);
  return gen.biome === 'dungeon' && keys.length > 0 && keys.every((key) => key === 'dungeonLevel') && patch.dungeonLevel !== gen.dungeonLevel;
}

/** Запоминает правки текущего уровня (или забывает их, если правок нет). */
export function stashLevel(store: LevelEdits, gen: GenSettings, edit: MapData | null): LevelEdits {
  const key = levelKey(gen);
  const level = gen.dungeonLevel ?? 0;
  const { [level]: _old, ...others } = store.key === key ? store.maps : {};
  return { key, maps: edit ? { ...others, [level]: edit } : others };
}

/** Правки уровня, если они сделаны при тех же настройках генерации. */
export function recallLevel(store: LevelEdits, gen: GenSettings): MapData | null {
  return store.key === levelKey(gen) ? store.maps[gen.dungeonLevel ?? 0] ?? null : null;
}
