import type { MapData, Biome, CryptArchetype, GenSettings, RenderSettings, SettlementDebugLayers } from '../lib/types';
import { DEFAULT_SETTLEMENT_DEBUG } from '../lib/gen/urban/debug';
import { BIOME_LABELS, CRYPT_ARCHETYPE_IDS, CRYPT_ARCHETYPE_LABELS, PRESETS } from '../lib/presets';
import { Slider, Toggle, pct } from './controls';
import { DensitySlider, SettlementChoices } from './SettlementPanel';
import { CryptOptions } from './CryptPanel';
import { ScenePicker } from './ScenePanel';
import { DungeonLayoutOptions } from './DungeonLayoutPanel';
import { isComplexArchetype } from '../lib/gen/complex/registry';
import { SettlementTypeOptions } from './SettlementTypePanel';
import { isSettlementType } from '../lib/gen/settlementTypes';
import { getArchetype } from '../lib/gen/archetypes';
import Icon from './Icon';

const CRYPT_ARCHETYPE_HINTS: Record<CryptArchetype, string> = {
  tomb: 'Центральный зал и залы вокруг',
  catacombs: 'Много небольших погребальных камер',
  temple: 'Большой храм с приделами',
  archive: 'Длинные залы-хранилища в два ряда',
  prison: 'Казематы и пост стражи',
};

interface Props {
  gen: GenSettings;
  map: MapData;
  render: RenderSettings;
  onGen: (patch: Partial<GenSettings>) => void;
  onRender: (patch: Partial<RenderSettings>) => void;
  onRandomSeed: () => void;
  history: number[];
}

export default function ControlPanel({ gen, map, render, onGen, onRender, onRandomSeed, history }: Props) {
  const isCave = gen.biome === 'cave', isDungeon = gen.biome === 'dungeon';
  const isSettlement = gen.biome === 'village' || gen.biome === 'town';
  const isOverland = !isCave && !isDungeon && !isSettlement;
  const structured = (gen.generationEngine ?? 'structured') === 'structured';
  // Сцена-архетип сама решает рельеф, воду и постройки: соответствующие
  // переключатели классической генерации прячем, чтобы не было «мёртвых» настроек.
  const scene = isOverland && structured ? getArchetype(gen.sceneArchetype) : undefined;
  const plan = map.plan;
  const problems = plan?.report?.problems ?? [];
  const warnings = plan?.report?.warnings ?? [];
  const actions = plan?.actions ?? [];
  const plural = (n: number, one: string, few: string, many: string): string => {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  };
  return <>
    <div className="sidebar-section generation-fields">
      <div className="section-heading"><h2>Генерация</h2><Icon name="sparkles" size={17} className="section-symbol" /></div>
      <label className="field-label">Биом<select aria-label="Биом" value={gen.biome} onChange={(e) => {
        const nextBiome = e.target.value as Biome;
        if ((nextBiome === 'town' || nextBiome === 'village') && gen.settlementType === undefined) {
          onGen({
            biome: nextBiome,
            settlement: nextBiome,
            settlementType: nextBiome === 'town' ? 'trade_town' : 'large_village',
            density: Math.max(gen.density, 0.64),
          });
        } else {
          onGen({ biome: nextBiome });
        }
      }}>
        {Object.entries(BIOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="field-label">Пресет<select aria-label="Пресет" value="" onChange={(e) => {
        if (e.target.value !== '') onGen({ ...PRESETS[Number(e.target.value)].gen, seed: Math.floor(Math.random() * 99999) });
      }}><option value="" disabled>Выбрать сценарий</option>
        {PRESETS.map((preset, i) => <option key={preset.name} value={i}>{preset.name}</option>)}
      </select></label>
      <div className="field-label"><label htmlFor="map-seed">Seed</label><div className="seed-field"><input id="map-seed" type="number" min={0} max={4294967295} value={gen.seed}
        onChange={(e) => onGen({ seed: Math.min(4294967295, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })} />
        <button type="button" className="square-btn" onClick={onRandomSeed} aria-label="Случайный seed" title="Случайный seed"><Icon name="dice" size={18} /></button>
      </div></div>
      {history.length > 0 && <select aria-label="Недавние seed" value="" onChange={(e) => onGen({ seed: Number(e.target.value) })}>
        <option value="" disabled>Недавние seed</option>{history.map((seed) => <option key={seed} value={seed}>{seed}</option>)}
      </select>}
      <Slider label="Ширина (клеток)" value={gen.width} min={10} max={100} onChange={(width) => onGen({ width })} />
      <Slider label="Высота (клеток)" value={gen.height} min={10} max={80} onChange={(height) => onGen({ height })} />
      <p className="size-note">До 100 × 80 клеток · большие карты автоматически оптимизируют детализацию</p>
      <button type="button" className="action-btn primary-btn generate-btn" onClick={onRandomSeed}><Icon name="dice" size={17} /> Сгенерировать</button>
    </div>
    {isOverland && structured && <details open className="sidebar-section generation-fields">
      <summary className="section-heading"><h2>Сцена</h2><Icon name="target" size={17} /></summary>
      <ScenePicker gen={gen} map={map} onGen={onGen} />
    </details>}
    {isDungeon && <details open className="sidebar-section generation-fields">
      <summary className="section-heading"><h2>Наполнение склепа</h2><Icon name="crypt" size={17} /></summary>
      <CryptOptions settings={gen} onChange={onGen} />
    </details>}
    {isSettlement && <div className="sidebar-section generation-fields">
      <div className="section-heading"><h2>Планировка</h2><Icon name="structure" size={17} className="section-symbol" /></div>
      <SettlementTypeOptions gen={gen} map={map} onGen={onGen} />
      {!isSettlementType(gen.settlementType) && <SettlementChoices style={gen.biome === 'town' ? 'town' : 'village'} onStyle={(style) => onGen({ biome: style, settlement: style })} />}
      <DensitySlider density={gen.density} onDensity={(density) => onGen({ density })} />
      <Toggle label="Площади и городские детали" checked={gen.publicSpaces} onChange={(publicSpaces) => onGen({ publicSpaces })} />
      <Toggle label="Река" checked={gen.river} onChange={(river) => onGen({ river })} />
      <Toggle label="Сеть улиц" checked={gen.road} onChange={(road) => onGen({ road })} />
    </div>}
    {!isSettlement && <details className="sidebar-section generation-fields" open>
      <summary className="section-heading"><h2>Ландшафт</h2><Icon name="chevron" size={15} className="section-symbol" /></summary>
      {!isDungeon && <Slider label={isCave ? 'Сглаживание стен' : 'Изрезанность рельефа'} value={gen.roughness} min={0} max={1} step={0.05} format={pct} onChange={(roughness) => onGen({ roughness })} />}
      <Slider label={isDungeon ? 'Затопленность' : 'Уровень воды'} value={gen.waterLevel} min={0} max={0.7} step={0.01} format={pct} onChange={(waterLevel) => onGen({ waterLevel })} />
      {isCave && <Slider label="Открытость пещеры" value={gen.caveOpenness} min={0} max={1} step={0.05} format={pct} onChange={(caveOpenness) => onGen({ caveOpenness })} />}
      {isDungeon && <>
        {/* В комплексе число залов задают кнопки «Размер», тип — архетип комплекса. */}
        {!isComplexArchetype(gen.dungeonArchetype) && <>
        <Slider label="Количество комнат" value={gen.rooms} min={2} max={14} onChange={(rooms) => onGen({ rooms })} />
        <label className="field-label">Тип склепа<select aria-label="Тип склепа" value={gen.cryptArchetype} onChange={(e) => onGen({ cryptArchetype: e.target.value as CryptArchetype })}>
          {CRYPT_ARCHETYPE_IDS.map((id) => <option key={id} value={id}>{CRYPT_ARCHETYPE_LABELS[id]}</option>)}
        </select></label>
        <p className="tool-hint">{CRYPT_ARCHETYPE_HINTS[gen.cryptArchetype]}</p>
        </>}
        <DungeonLayoutOptions gen={gen} map={map} onGen={onGen} />
      </>}
      {isOverland && !scene && <>
        <Toggle label="Река" checked={gen.river} onChange={(river) => onGen({ river })} />
        <Toggle label="Дорога с мостами" checked={gen.road} onChange={(road) => onGen({ road })} />
      </>}
      {scene?.road === 'optional' && <Toggle label="Дорога к месту сцены" checked={gen.road} onChange={(road) => onGen({ road })} />}
    </details>}
    <details className="sidebar-section generation-fields">
      <summary className="section-heading"><h2>Объекты</h2><Icon name="chevron" size={15} className="section-symbol" /></summary>
      <Slider label={isDungeon || isCave ? 'Грибы' : 'Растительность'} value={gen.vegetation} min={0} max={1} step={0.05} format={pct} onChange={(vegetation) => onGen({ vegetation })} />
      <Slider label={isDungeon ? 'Обломки' : 'Камни и валуны'} value={gen.rocks} min={0} max={1} step={0.05} format={pct} onChange={(rocks) => onGen({ rocks })} />
      {isOverland && <>
        {!scene && <>
          <Slider label="Постройки" value={gen.structures} min={0} max={6} onChange={(structures) => onGen({ structures })} />
          <Toggle label="Руины вместо целых зданий" checked={gen.ruined} onChange={(ruined) => onGen({ ruined })} />
        </>}
        <Toggle
          label="Структурная генерация (эксперимент)"
          checked={(gen.generationEngine ?? 'structured') === 'structured'}
          onChange={(value) => onGen({ generationEngine: value ? 'structured' : 'legacy' })}
        />
      </>}
    </details>
    <details className="sidebar-section generation-fields">
      <summary className="section-heading"><h2>Сетка и вид</h2><Icon name="chevron" size={15} className="section-symbol" /></summary>
      <Slider label="Разрешение клетки (px)" value={render.cellSize} min={16} max={72} step={2} onChange={(cellSize) => onRender({ cellSize })} />
      {isDungeon && <Slider label="Толщина стен" value={render.wallThickness} min={0.15} max={1.2} step={0.01} format={(v) => v.toFixed(2) + ' кл.'} onChange={(wallThickness) => onRender({ wallThickness })} />}
      <Toggle label="Сетка" checked={render.showGrid} onChange={(showGrid) => onRender({ showGrid })} />
      {render.showGrid && <>
        <label className="field-label">Тип сетки<select aria-label="Тип сетки" value={render.gridType} onChange={(e) => onRender({ gridType: e.target.value === 'hex' ? 'hex' : 'square' })}><option value="square">Квадратная</option><option value="hex">Гексагональная</option></select></label>
        <Slider label="Непрозрачность сетки" value={render.gridOpacity} min={0.05} max={1} step={0.05} format={pct} onChange={(gridOpacity) => onRender({ gridOpacity })} />
        <label className="color-picker">Цвет сетки<input type="color" value={render.gridColor} onChange={(e) => onRender({ gridColor: e.target.value })} /></label>
      </>}
      <Toggle label="Живописные текстуры" checked={render.texture} onChange={(texture) => onRender({ texture })} />
      <Toggle label="Затенение рельефа" checked={render.shading} onChange={(shading) => onRender({ shading })} />
      <Toggle label="Виньетка" checked={render.vignette} onChange={(vignette) => onRender({ vignette })} />
      <Toggle label="Растительность" checked={render.showTrees} onChange={(showTrees) => onRender({ showTrees })} />
      <Toggle label="Камни" checked={render.showRocks} onChange={(showRocks) => onRender({ showRocks })} />
      <Toggle label="Мелкий декор" checked={render.showDecor !== false} onChange={(showDecor) => onRender({ showDecor })} />
      <Toggle label="Разметка генерации (debug)" checked={render.showDebug === true} onChange={(showDebug) => onRender({ showDebug })} />
      {render.showDebug === true && isSettlement && map.plan?.settlement && (() => {
        const dbg: Required<SettlementDebugLayers> = { ...DEFAULT_SETTLEMENT_DEBUG, ...(render.settlementDebug ?? {}) };
        const patch = (key: keyof SettlementDebugLayers, val: boolean) =>
          onRender({ settlementDebug: { ...dbg, [key]: val } });
        return <>
          <Toggle label="Debug: Граница города (Footprint)" checked={dbg.footprint} onChange={(v) => patch('footprint', v)} />
          <Toggle label="Debug: Плотность (Urban Density)" checked={dbg.density} onChange={(v) => patch('density', v)} />
          <Toggle label="Debug: Районы (Districts)" checked={dbg.districts} onChange={(v) => patch('districts', v)} />
          <Toggle label="Debug: Кварталы (Blocks)" checked={dbg.blocks} onChange={(v) => patch('blocks', v)} />
          <Toggle label="Debug: Участки (Plots)" checked={dbg.plots} onChange={(v) => patch('plots', v)} />
          <Toggle label="Debug: Иерархия дорог (4 ур.)" checked={dbg.roadHierarchy} onChange={(v) => patch('roadHierarchy', v)} />
          <Toggle label="Debug: Фасады зданий (Frontage)" checked={dbg.frontage} onChange={(v) => patch('frontage', v)} />
          <Toggle label="Debug: Дворы и флигели (Courtyards)" checked={dbg.courtyards} onChange={(v) => patch('courtyards', v)} />
          <Toggle label="Debug: Открытые зоны (Empty Areas)" checked={dbg.emptyAreas} onChange={(v) => patch('emptyAreas', v)} />
          <Toggle label="Debug: Доступность (Accessibility)" checked={dbg.accessibility} onChange={(v) => patch('accessibility', v)} />
          <Toggle label="Debug: Влияние реки (River Influence)" checked={dbg.riverInfluence} onChange={(v) => patch('riverInfluence', v)} />
          <Toggle label="Debug: Ориентиры и цепочки" checked={dbg.landmarks} onChange={(v) => patch('landmarks', v)} />
          <Toggle label="Debug: Подписи районов" checked={dbg.districtLabels} onChange={(v) => patch('districtLabels', v)} />
        </>;
      })()}
      <Toggle label="Постройки" checked={render.showStructures} onChange={(showStructures) => onRender({ showStructures })} />
      {isDungeon && <Toggle label="Метки ловушек" checked={render.showSecrets} onChange={(showSecrets) => onRender({ showSecrets })} />}
      {(isSettlement || (map.civic?.length ?? 0) > 0) && <Toggle label="Городские объекты" checked={render.showCivic} onChange={(showCivic) => onRender({ showCivic })} />}
      {isOverland && (map.crypt?.length ?? 0) > 0 && <Toggle label="Предметы сцены" checked={render.showCrypt} onChange={(showCrypt) => onRender({ showCrypt })} />}
      <Toggle label="Сундуки" checked={render.showChests} onChange={(showChests) => onRender({ showChests })} />
    </details>

    <div className="sidebar-section generation-report">
      <div className="section-heading"><h2>Отчёт генерации</h2><Icon name={problems.length ? 'target' : 'check'} size={17} className="section-symbol" /></div>
      <div className={`gen-report-state ${problems.length ? 'is-warning' : 'is-ok'}`}>
        <span className="gen-report-dot" />
        {problems.length === 0 ? 'Проверка пройдена' : `${problems.length} ${plural(problems.length, 'проблема', 'проблемы', 'проблем')}`}
      </div>
      {plan?.archetype && <p className="scene-report">
        Сцена «{plan.archetype.label}»{plan.archetype.requested ? ` (замена для «${getArchetype(plan.archetype.requested)?.label ?? plan.archetype.requested}»)` : ''}
        {' · '}вода {Math.round(plan.archetype.landscape.waterShare * 100)}%, скалы {Math.round(plan.archetype.landscape.rockShare * 100)}%
        {plan.archetype.landscape.lakes > 0 ? `, озёр ${plan.archetype.landscape.lakes}` : ''}
        {plan.archetype.landscape.checks.some((check) => !check.ok) ? ' · есть замечания к рельефу' : ' · рельеф проверен'}
      </p>}
      {plan && (
        <div className="gen-report-stats">
          <span>{plan.zones.length} зон</span>
          <span>{plan.poi.length} POI</span>
          <span>{plan.groups.length} групп</span>
          {(plan.composition?.openSpaces.length ?? 0) > 0 && (
            <span>{plan.composition!.openSpaces.length} пространств</span>
          )}
          {(plan.composition?.masses.length ?? 0) > 0 && (
            <span>{plan.composition!.masses.length} масс леса</span>
          )}
          <span>{(plan.roads ?? []).filter((path) => path.type === 'trail').length} троп</span>
          {plan.spawn && <span>старт {plan.spawn.x}:{plan.spawn.y}</span>}
        </div>
      )}
      {problems.length > 0 && (
        <ul className="gen-report-list">
          {problems.slice(0, 5).map((problem, index) => <li key={`${problem.kind}-${index}`}>{problem.message}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="gen-report-list is-warnings">
          {warnings.slice(0, 3).map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}
      {actions.length > 0 && (
        <>
          <div className="gen-report-label">Починено автоматически</div>
          <ul className="gen-report-list is-actions">
            {actions.slice(0, 5).map((action, index) => <li key={index}>{action}</li>)}
          </ul>
        </>
      )}
      {!plan && <p className="field-hint">Для этого биома план генерации пока не строится.</p>}
    </div>
  </>;
}