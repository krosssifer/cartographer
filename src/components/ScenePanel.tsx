import { useState } from 'react';
import type { Biome, GenSettings, MapData } from '../lib/types';
import { BIOME_LABELS } from '../lib/presets';
import {
  ARCHETYPE_CATEGORY_LABELS,
  SCENE_ARCHETYPES,
  archetypeSupports,
  getArchetype,
  resolveArchetype,
  type ArchetypeCategory,
  type SceneArchetypeDef,
} from '../lib/gen/archetypes';

const CATEGORIES: ArchetypeCategory[] = ['natural', 'architectural', 'special'];

const GROUND: Record<string, string> = {
  forest: '#5d7a3a', plains: '#8a9a4a', swamp: '#5b6343', desert: '#c8a96a', snow: '#dfe6ea',
};

/**
 * Схема сцены: рельеф, вода, дорога, массы и главный центр — то, что архетип
 * задаёт генератору. Рисуется из данных реестра, поэтому новая запись в
 * реестре сразу получает своё превью.
 */
export function ArchetypePreview({ archetype, biome }: { archetype: SceneArchetypeDef; biome: Biome }) {
  const ground = GROUND[biome] ?? GROUND.forest;
  const relief = archetype.relief;
  const comp = archetype.composition;
  const focal = comp.focal === 'thirds' ? { x: 80, y: 26 }
    : comp.focal === 'cliff' ? { x: 60, y: 30 }
      : comp.focal === 'road' ? { x: 68, y: 40 }
        : comp.focal === 'crossing' ? { x: 60, y: 38 }
          : { x: 60 + comp.asymmetry * 14, y: 36 - comp.asymmetry * 6 };
  const focalR = 6 + comp.focalRadius * 60;
  // Массы — напротив смещения фокуса (так их ставит и генератор).
  const massSpots = [
    { x: 20, y: 16 }, { x: 22, y: 58 }, { x: 102, y: 60 }, { x: 100, y: 12 }, { x: 40, y: 64 }, { x: 84, y: 66 },
  ].slice(0, Math.min(6, comp.masses));
  const massR = 9 * comp.massScale;
  const river = archetype.water === 'river' || archetype.water === 'river_wide' || archetype.water === 'stream';
  const riverWidth = archetype.water === 'river_wide' ? 9 : archetype.water === 'river' ? 6 : 3;
  const riverPath = archetype.course === 'along' ? 'M0 52 C30 44 50 60 80 50 S110 46 120 50' : 'M48 0 C58 18 50 30 60 40 S70 60 64 72';
  const road = archetype.road !== 'none';
  const roadPath = comp.focal === 'road' ? 'M0 40 C30 36 50 44 68 40 S100 34 120 38' : 'M0 34 C28 30 46 40 70 36 S100 30 120 32';
  const cliffs = relief === 'pass' || relief === 'ridge' || relief === 'cliffside' || relief === 'valley' || relief === 'plateau';
  return <svg className="scene-preview" viewBox="0 0 120 72" role="img" aria-label={`Схема сцены «${archetype.label}»`}>
    <rect width="120" height="72" fill={ground} />
    {cliffs && relief === 'pass' && <>
      <path d="M0 0 H120 V20 C90 26 70 14 40 22 S10 18 0 22 Z" fill="#8c8a84" />
      <path d="M0 72 H120 V52 C96 46 70 58 44 50 S12 56 0 50 Z" fill="#8c8a84" />
    </>}
    {cliffs && relief === 'valley' && <>
      <path d="M0 0 H120 V14 C80 20 40 10 0 16 Z" fill="#8c8a84" />
      <path d="M0 72 H120 V60 C80 54 40 64 0 58 Z" fill="#8c8a84" />
    </>}
    {cliffs && (relief === 'cliffside' || relief === 'ridge' || relief === 'plateau') && <path d="M0 0 H120 V16 C96 22 74 12 54 20 S16 14 0 22 Z" fill="#8c8a84" />}
    {archetype.water === 'lakes' && <>
      <ellipse cx="28" cy="22" rx="16" ry="10" fill="#4f7fa8" />
      <ellipse cx="96" cy="56" rx="13" ry="8" fill="#4f7fa8" />
    </>}
    {archetype.water === 'marsh' && <>
      <path d="M0 50 C20 40 34 60 52 52 S80 66 120 54 V72 H0 Z" fill="#4f7fa8" opacity="0.85" />
      <path d="M70 6 C84 2 100 14 118 8 V26 C100 30 84 20 70 24 Z" fill="#4f7fa8" opacity="0.85" />
    </>}
    {river && <path d={riverPath} stroke="#4f7fa8" strokeWidth={riverWidth} fill="none" strokeLinecap="round" />}
    {road && <path d={roadPath} stroke={archetype.road === 'track' ? '#8a7350' : '#a07a4a'} strokeWidth="3.5" fill="none" strokeDasharray={archetype.road === 'track' ? '5 3' : undefined} />}
    {massSpots.map((spot, index) => <circle key={index} cx={spot.x} cy={spot.y} r={massR * (index === 0 ? 1.15 : 0.9)} fill="#2f4a26" opacity="0.9" />)}
    <circle cx={focal.x} cy={focal.y} r={focalR} fill="none" stroke="#f3d67a" strokeWidth="1.6" strokeDasharray="3 2" />
    <circle cx={focal.x} cy={focal.y} r="1.8" fill="#f3d67a" />
  </svg>;
}

/** Выбор сцены-архетипа в панели генерации открытых биомов. */
export function ScenePicker({ gen, map, onGen }: { gen: GenSettings; map: MapData; onGen: (patch: Partial<GenSettings>) => void }) {
  const current = getArchetype(gen.sceneArchetype);
  const [category, setCategory] = useState<ArchetypeCategory>(current?.category ?? 'natural');
  const resolution = current ? resolveArchetype(current.id, gen.biome) : undefined;
  const items = SCENE_ARCHETYPES.filter((item) => item.category === category);
  const report = map.plan?.archetype;
  return <div className="scene-picker">
    <label className="field-label">Сцена
      <select aria-label="Сцена" value={current?.id ?? 'auto'} onChange={(e) => {
        const next = getArchetype(e.target.value);
        if (next) setCategory(next.category);
        onGen({ sceneArchetype: e.target.value });
      }}>
        <option value="auto">Автоматически (классическая генерация)</option>
        {CATEGORIES.map((id) => <optgroup key={id} label={ARCHETYPE_CATEGORY_LABELS[id]}>
          {SCENE_ARCHETYPES.filter((item) => item.category === id).map((item) => <option key={item.id} value={item.id}>
            {item.label}{archetypeSupports(item, gen.biome) ? '' : ' — замена'}
          </option>)}
        </optgroup>)}
      </select>
    </label>
    <div className="scene-categories" role="group" aria-label="Категория сцен">
      {CATEGORIES.map((id) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{ARCHETYPE_CATEGORY_LABELS[id]}</button>)}
    </div>
    <div className="scene-grid" role="listbox" aria-label={ARCHETYPE_CATEGORY_LABELS[category]}>
      {items.map((item) => <button key={item.id} type="button" role="option" aria-selected={current?.id === item.id}
        className={archetypeSupports(item, gen.biome) ? undefined : 'is-fallback'}
        title={archetypeSupports(item, gen.biome) ? item.description : `${item.description} (в биоме «${BIOME_LABELS[gen.biome]}» будет заменена)`}
        onClick={() => onGen({ sceneArchetype: current?.id === item.id ? 'auto' : item.id })}>{item.label}</button>)}
    </div>
    {current && <div className="scene-card">
      <ArchetypePreview archetype={resolution?.archetype ?? current} biome={gen.biome} />
      <p className="scene-description">{current.description}</p>
      <div className="scene-biomes" aria-label="Подходящие биомы">
        {current.biomes.map((biome) => <span key={biome} className={biome === gen.biome ? 'is-current' : undefined}>{BIOME_LABELS[biome]}</span>)}
      </div>
      {resolution?.requested && <p className="scene-fallback">
        В биоме «{BIOME_LABELS[gen.biome]}» эта сцена неуместна — используется «{resolution.archetype.label}».
      </p>}
      <p className="tool-hint">Рельеф, вода и дорога задаются сценой; ползунки растительности и камней по-прежнему действуют.</p>
    </div>}
    {report && report.features.length > 0 && <ul className="gen-report-list is-actions scene-notes">
      {report.features.slice(0, 4).map((note, index) => <li key={index}>{note}</li>)}
    </ul>}
  </div>;
}
