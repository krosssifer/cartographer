import { useMemo, useState, type CSSProperties } from 'react';
import { artUrl } from '../lib/assets';
import { generateSettlement } from '../lib/settlement';
import { BUILDING_SIZES, CIVIC_KINDS, CIVIC_KIT, CIVIC_SIZES, isSettlement, ROOF_KIT, ROOF_SHAPES } from '../lib/settlementKit';
import type { EditorSettings, EditorTool, GenSettings, MapData, RoofShape, SettlementStyle } from '../lib/types';
import Icon from './Icon';
import { Toggle } from './controls';

export type LayoutSettings = { style: SettlementStyle; density: number; publicSpaces: boolean };

export function SettlementChoices({ style, onStyle }: { style: SettlementStyle; onStyle: (style: SettlementStyle) => void }) {
  return <div className="settlement-types" role="group" aria-label="Тип поселения">
    <button type="button" aria-pressed={style === 'village'} onClick={() => onStyle('village')}><Icon name="home" size={16} /> Деревня</button>
    <button type="button" aria-pressed={style === 'town'} onClick={() => onStyle('town')}><Icon name="structure" size={16} /> Город</button>
  </div>;
}

export function DensitySlider({ density, onDensity }: { density: number; onDensity: (value: number) => void }) {
  const value = Math.round(density * 100);
  return <label className="density-control">
    <span className="density-label">Плотность застройки <output>{value}<small>%</small></output></span>
    <input type="range" aria-label="Плотность застройки" aria-valuetext={`${value}%`} min="0" max="100" step="1" value={value} onChange={(e) => onDensity(Number(e.currentTarget.value) / 100)} style={{ '--density': `${value}%` } as CSSProperties} />
    <span className="density-extents"><span>Без застройки</span><span>Плотно</span></span>
  </label>;
}

const houseCount = (n: number) => `${n} ${n % 100 >= 11 && n % 100 <= 14 ? 'домов' : n % 10 === 1 ? 'дом' : n % 10 >= 2 && n % 10 <= 4 ? 'дома' : 'домов'}`;

function PlanPanel({ gen, map, onApply, locked }: { gen: GenSettings; map: MapData; onApply: (value: LayoutSettings) => void; locked: boolean }) {
  const [draft, setDraft] = useState<LayoutSettings>(() => ({ style: isSettlement(gen.biome) ? gen.biome : gen.settlement, density: gen.density, publicSpaces: gen.publicSpaces }));
  const changed = draft.style !== map.biome || draft.density !== gen.density || draft.publicSpaces !== gen.publicSpaces;
  const estimate = useMemo(() => changed ? (generateSettlement({ ...gen, biome: draft.style, density: draft.density, publicSpaces: draft.publicSpaces }).buildings?.length ?? 0) : (map.buildings?.length ?? 0),
    [gen, draft, changed, map.buildings]);
  const patch = (value: Partial<LayoutSettings>) => setDraft((old) => ({ ...old, ...value }));
  return <section className="sidebar-section layout-section" aria-label="Планировка поселения">
    <div className="section-heading"><h2><Icon name="compass" size={17} /> Планировка</h2><span aria-live="polite" className="plot-count">{changed ? 'В плане: ' : ''}{houseCount(estimate)}</span></div>
    <SettlementChoices style={draft.style} onStyle={(style) => patch({ style })} />
    <DensitySlider density={draft.density} onDensity={(density) => patch({ density })} />
    <Toggle label="Площади и городские детали" checked={draft.publicSpaces} onChange={(publicSpaces) => patch({ publicSpaces })} />
    <button type="button" className="action-btn plan-apply" disabled={locked} onClick={() => onApply(draft)}><Icon name="sparkles" size={15} /> Применить планировку</button>
    {locked && <p className="tool-hint">Разблокируйте слои карты, чтобы изменить планировку.</p>}
    {draft.style !== map.biome && !locked && <p className="tool-hint">Смена типа создаст новую карту. Действие можно отменить.</p>}
  </section>;
}

interface Props {
  gen: GenSettings;
  map: MapData;
  settings: EditorSettings;
  layoutLocked: boolean;
  onApply: (value: LayoutSettings) => void;
  onSettings: (value: Partial<EditorSettings>) => void;
  onTool: (tool: EditorTool) => void;
  onRotate: () => void;
}

export default function SettlementPanel({ gen, map, settings: s, layoutLocked, onApply, onSettings, onTool, onRotate }: Props) {
  return <div className="settlement-panel">
    <PlanPanel key={`${gen.seed}:${gen.biome}:${gen.density}:${gen.publicSpaces}:${gen.width}:${gen.height}`} gen={gen} map={map} onApply={onApply} locked={layoutLocked} />
    <section className="sidebar-section roof-section" aria-label="Кровля и постройки">
      <div className="section-heading"><h2><Icon name="roof" size={17} /> Кровля</h2><button type="button" className="quiet-btn build-tool" title="Поставить дом (N)" aria-pressed={s.tool === 'building'} onClick={() => onTool(s.tool === 'building' ? 'roof' : 'building')}><Icon name="plus" size={14} /> Дом</button></div>
      <div className="roof-swatches" role="group" aria-label="Материал крыши">
        {ROOF_KIT.map((roof) => <button key={roof.id} type="button" title={roof.label} aria-label={roof.label} aria-pressed={s.roofMaterial === roof.id}
          style={{ backgroundColor: roof.color, backgroundImage: `url(${artUrl(roof.art)})` }} onClick={() => { onSettings({ roofMaterial: roof.id }); if (s.tool !== 'building') onTool('roof'); }} />)}
      </div>
      <div className="roof-options">
        <span>{ROOF_KIT[s.roofMaterial].label}</span>
        <select aria-label="Форма крыши" value={s.roofShape} onChange={(e) => { onSettings({ roofShape: e.target.value as RoofShape }); if (s.tool !== 'building') onTool('roof'); }}>
          {Object.entries(ROOF_SHAPES).map(([shape, label]) => <option value={shape} key={shape}>{label}</option>)}
        </select>
      </div>
      {s.tool === 'building' ? <div className="stamp-options">
        <select aria-label="Размер дома" value={s.buildingSize} onChange={(e) => onSettings({ buildingSize: Number(e.target.value) })}>
          {BUILDING_SIZES.map(({ w, h, label }, index) => <option value={index} key={label}>{label} · {w} × {h}</option>)}
        </select><button type="button" className="quiet-btn" title="Повернуть дом (Q)" onClick={onRotate}><Icon name="rotate" size={15} /> {s.stampRotation}°</button>
      </div> : <p className="tool-hint">Выберите материал и кликните по крыше.</p>}
    </section>
    <section className="sidebar-section civic-section" aria-label="Городские объекты">
      <div className="section-heading"><h2><Icon name="market" size={17} /> Городские объекты</h2>{s.tool === 'civic' && <button type="button" className="quiet-btn" title="Повернуть объект (Q)" onClick={onRotate}><Icon name="rotate" size={14} /> {s.stampRotation}°</button>}</div>
      <div className="civic-grid">
        {CIVIC_KINDS.map((kind) => {
          const prop = CIVIC_KIT[kind];
          return <button key={kind} type="button" data-civic={kind} title={prop.label} aria-pressed={s.tool === 'civic' && s.civicKind === kind}
            onClick={() => { onSettings({ civicKind: kind, civicSize: kind === s.civicKind ? s.civicSize : 0 }); onTool('civic'); }}>
            <img src={artUrl(prop.art)} alt="" /><span>{prop.label}</span>
          </button>;
        })}
      </div>
      {s.tool === 'civic' && (s.civicKind === 'market' || s.civicKind === 'square') && <label className="stamp-options civic-size">Размер
        <select aria-label={s.civicKind === 'square' ? 'Размер площади' : 'Размер рынка'} value={s.civicSize} onChange={(e) => onSettings({ civicSize: Number(e.target.value) })}>
          {CIVIC_SIZES[s.civicKind].map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
        </select>
      </label>}
    </section>
  </div>;
}