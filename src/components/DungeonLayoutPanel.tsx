import type { GenSettings, MapData } from '../lib/types';
import { Slider } from './controls';
import { DOOR_KIND_LABELS } from '../lib/doors';
import { MAX_DUNGEON_LEVELS, SHAPE_LABELS, effectiveLevels } from '../lib/gen/dungeonArchitect';
import {
  COMPLEX_ARCHETYPES, COMPLEX_SIZES, CORRIDOR_LABELS, GEOMETRY_LABELS, GEOMETRY_MODES, TIER_LABELS, TOPOLOGIES, TOPOLOGY_LABELS,
  getComplexArchetype, isComplexArchetype, type CorridorKind, type NodeTier,
} from '../lib/gen/complex/registry';
import { DUNGEON_CONDITIONS, DUNGEON_STYLES, getCondition, getStyle } from '../lib/gen/complex/styles';
import { LEVEL_ROLE_LABELS, LINK_LABELS } from '../lib/gen/complex';

interface Props {
  gen: GenSettings;
  map: MapData;
  onGen: (patch: Partial<GenSettings>) => void;
}

type Layout = 'classic' | 'varied' | 'complex';

/**
 * Планировка подземелья: классическая (прямоугольные залы, как раньше),
 * разнообразная (формы залов, виды дверей, уровни) или архитектурный комплекс —
 * граф по архетипу, составные залы, типы коридоров, стиль и состояние.
 * В комплексе композицию решает генератор; в интерфейсе — только группы
 * «Тип, Структура, Геометрия, Стиль, Состояние, Размер, Уровни», и у каждой
 * есть вариант «по архетипу».
 */
export function DungeonLayoutOptions({ gen, map, onGen }: Props) {
  const complex = isComplexArchetype(gen.dungeonArchetype);
  const layout: Layout = complex ? 'complex' : gen.dungeonLayout === 'varied' ? 'varied' : 'classic';
  const wanted = Math.max(1, Math.min(MAX_DUNGEON_LEVELS, gen.dungeonLevels ?? 1));
  const levels = effectiveLevels({ ...gen, dungeonLevels: wanted });
  const level = Math.min(levels - 1, Math.max(0, gen.dungeonLevel ?? 0));
  const report = map.plan?.dungeon;
  const archetype = complex ? getComplexArchetype(gen.dungeonArchetype!) : undefined;
  const switchLayout = (next: Layout) => {
    if (next === 'complex') onGen({ dungeonArchetype: 'fortress', dungeonLevels: wanted, dungeonLevel: 0 });
    else if (next === 'varied') onGen({ dungeonArchetype: undefined, dungeonLayout: 'varied', dungeonLevels: wanted, dungeonLevel: 0 });
    else onGen({ dungeonArchetype: undefined, dungeonLayout: 'classic' });
  };
  const cx = report?.complex;
  const quality = map.plan?.report?.dungeonDressing;
  return <>
    <label className="field-label">Планировка<select aria-label="Планировка подземелья" value={layout} onChange={(e) => switchLayout(e.target.value as Layout)}>
      <option value="classic">Классическая — прямоугольные залы</option>
      <option value="varied">Разнообразная — формы, двери, уровни</option>
      <option value="complex">Архитектурный комплекс — по архетипу</option>
    </select></label>
    {archetype && <>
      <h3 className="dungeon-group">Тип</h3>
      <label className="field-label">Архетип<select aria-label="Архетип комплекса" value={archetype.id} onChange={(e) => onGen({ dungeonArchetype: e.target.value, dungeonLevel: 0 })}>
        {COMPLEX_ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select></label>
      <p className="tool-hint">{archetype.hint}</p>
      <h3 className="dungeon-group">Структура и геометрия</h3>
      <label className="field-label">Структура<select aria-label="Структура комплекса" value={gen.dungeonTopology ?? 'auto'} onChange={(e) => onGen({ dungeonTopology: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По архетипу и seed</option>
        {TOPOLOGIES.map((t) => <option key={t} value={t}>{TOPOLOGY_LABELS[t]}</option>)}
      </select></label>
      <label className="field-label">Геометрия<select aria-label="Геометрия залов" value={gen.dungeonGeometry ?? 'auto'} onChange={(e) => onGen({ dungeonGeometry: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По архетипу</option>
        {GEOMETRY_MODES.map((g) => <option key={g} value={g}>{GEOMETRY_LABELS[g]}</option>)}
      </select></label>
      <h3 className="dungeon-group">Стиль и состояние</h3>
      <label className="field-label">Стиль<select aria-label="Архитектурный стиль" value={gen.dungeonStyle ?? 'auto'} onChange={(e) => onGen({ dungeonStyle: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По архетипу — {getStyle(archetype.style).label.toLowerCase()}</option>
        {DUNGEON_STYLES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
      </select></label>
      <label className="field-label">Состояние<select aria-label="Состояние комплекса" value={gen.dungeonCondition ?? 'auto'} onChange={(e) => onGen({ dungeonCondition: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По архетипу и глубине</option>
        {DUNGEON_CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select></label>
      <h3 className="dungeon-group">Размер</h3>
      <div className="scene-categories" role="group" aria-label="Размер комплекса" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {COMPLEX_SIZES.map((size) => <button key={size.id} type="button" aria-pressed={gen.rooms === size.rooms} title={`${size.rooms} залов`}
          onClick={() => gen.rooms !== size.rooms && onGen({ rooms: size.rooms })}>{size.label}</button>)}
      </div>
      <p className="tool-hint">Размер — число залов; на тесной карте лишние узлы графа отбрасываются, и отчёт ниже это показывает.</p>
    </>}
    {layout !== 'classic' && <>
      {complex && <h3 className="dungeon-group">Уровни</h3>}
      <Slider label="Уровней" value={wanted} min={1} max={MAX_DUNGEON_LEVELS} onChange={(dungeonLevels) => onGen({ dungeonLevels, dungeonLevel: Math.min(level, dungeonLevels - 1) })} />
      {levels < wanted && <p className="scene-fallback">Карта меньше 21 клетки по большей стороне: лестницам между уровнями не хватает места, строится один уровень.</p>}
      {levels > 1 && <div className="scene-categories dungeon-levels" role="group" aria-label="Уровень подземелья" style={{ gridTemplateColumns: `repeat(${levels}, 1fr)` }}>
        {Array.from({ length: levels }, (_, index) => <button key={index} type="button" aria-pressed={index === level}
          onClick={() => index !== level && onGen({ dungeonLevel: index })}>Уровень {index + 1}</button>)}
      </div>}
      {levels > 1 && <p className="tool-hint">{gen.dungeonWallsOnly ? "В режиме «Только стены» лестницы и другие связи не расставляются автоматически. " : "Связи соседних уровней (лестницы, шахты, обвалы) стоят на одних и тех же клетках. "}Ручные правки уровня сохраняются при переходе на другой уровень, пока не изменены настройки генерации.</p>}
      {report && !cx && <p className="scene-report">
        Залов {report.placed} из {report.requested} · колец {report.loops} · тупиков {report.deadEnds}{report.secretRooms ? ` · тайных ${report.secretRooms}` : ''}<br />
        Формы: {Object.entries(report.shapes).map(([shape, count]) => `${SHAPE_LABELS[shape as keyof typeof SHAPE_LABELS].toLowerCase()} ${count}`).join(', ')}<br />
        {gen.dungeonWallsOnly ? "Двери не расставлены" : <>Двери: {Object.entries(report.doors).map(([kind, count]) => `${DOOR_KIND_LABELS[kind as keyof typeof DOOR_KIND_LABELS].toLowerCase()} ${count}`).join(', ')}</>}
        {!report.connected && <><br />Внимание: не все залы достижимы от входа.</>}
      </p>}
      {report && cx && <p className="scene-report">
        {cx.label} · {TOPOLOGY_LABELS[cx.topology].toLowerCase()} структура · {LEVEL_ROLE_LABELS[cx.levelRole]}<br />
        Стиль: {getStyle(cx.style).label.toLowerCase()} · состояние: {getCondition(cx.condition).label.toLowerCase()}{cx.naturalShare > .02 ? ` · природного пола ${Math.round(cx.naturalShare * 100)}%` : ''}<br />
        Залов {report.placed} из {report.requested}{cx.dropped ? ` (не поместилось ${cx.dropped})` : ''} · колец {report.loops} · составных {cx.composite}{cx.breaches ? ` · проломов ${cx.breaches}` : ''}<br />
        Узлы: {Object.entries(cx.tiers).map(([tier, count]) => `${TIER_LABELS[tier as NodeTier]} ${count}`).join(', ')}<br />
        Коридоры: {Object.entries(cx.corridors).map(([kind, count]) => `${CORRIDOR_LABELS[kind as CorridorKind]} ${count}`).join(', ')}<br />
        Формы: {Object.entries(report.shapes).map(([shape, count]) => `${SHAPE_LABELS[shape as keyof typeof SHAPE_LABELS].toLowerCase()} ${count}`).join(', ')}<br />
        Свет: горит {cx.lights.lit}, погашено {cx.lights.unlit}
        {cx.links.length > 0 && <><br />Связи: {cx.links.map((link) => `${LINK_LABELS[link.kind]} ${link.dir === 'up' ? 'вверх' : 'вниз'}`).join(', ')}</>}
        {cx.mechanisms.length > 0 && <><br />Механизмы: {[...new Set(cx.mechanisms)].join('; ')}</>}
        {!report.connected && <><br />Внимание: не все залы достижимы от входа.</>}
      </p>}
      {quality && <details className="scene-report"><summary>Качество оформления: ошибок {quality.errors.length}, предупреждений {quality.warnings.length}</summary>
        {quality.rooms.map((room) => <div key={room.roomId}>{room.roomId} · {room.purpose}: сцен {room.scenes}, кластеров {room.clusters}{room.errors.length ? ` · ошибок ${room.errors.length}` : ''}{room.warnings.length ? ` · замечаний ${room.warnings.length}` : ''}</div>)}
        {[...quality.errors, ...quality.warnings].map((message, i) => <div key={i}>{message}</div>)}
      </details>}

    </>}
  </>;
}
