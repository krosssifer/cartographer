import Icon from './Icon';
import { Slider } from './controls';
import { artUrl, TILE_ART } from '../lib/assets';
import { CHESTS, CHEST_KINDS } from '../lib/chests';
import { DOOR_KINDS, DOOR_KIND_LABELS } from '../lib/doors';
import { TERRAIN_COLORS, TERRAIN_LABELS } from '../lib/palette';
import type { DoorKind, EditorSettings, EditorTool, LayerId, MapData, Selection, Terrain, TreeKind } from '../lib/types';
import { cn } from '../utils/cn';

export const TOOL_LABELS: Record<EditorTool, string> = {
  brush: 'Кисть', eraser: 'Ластик', fill: 'Заливка', rect: 'Область', select: 'Выбор',
  hand: 'Рука', tree: 'Дерево', rock: 'Камни', structure: 'Руины', pick: 'Пипетка', paste: 'Вставка', chest: 'Сундук',
  building: 'Дом', roof: 'Кровля', civic: 'Городской объект', furniture: 'Мебель', crypt: 'Объект склепа',
};

export const SHORTCUTS: Record<EditorTool, string> = {
  brush: 'B', eraser: 'E', fill: 'F', rect: 'R', select: 'V', hand: 'H', tree: 'T', rock: 'K', structure: 'U', pick: 'I', paste: 'P', chest: 'C',
  building: 'N', roof: 'J', civic: 'L', furniture: 'M', crypt: 'D',
};

export const LAYER_NAMES: Record<LayerId, string> = { terrain: 'Ландшафт', trees: 'Растительность', rocks: 'Камни', structures: 'Постройки', civic: 'Городские объекты', chests: 'Сундуки', crypt: 'Объекты склепа' };
const layerIcons: Record<LayerId, string> = { terrain: 'layers', trees: 'tree', rocks: 'rock', structures: 'structure', civic: 'market', chests: 'chest', crypt: 'crypt' };
const layerOrder: LayerId[] = ['crypt', 'civic', 'chests', 'trees', 'rocks', 'structures', 'terrain'];
const tools: EditorTool[] = ['brush', 'eraser', 'fill', 'rect', 'select', 'hand'];
const terrains = Object.keys(TERRAIN_LABELS) as Terrain[];

interface Props {
  settings: EditorSettings;
  activeLayer: LayerId;
  onSettings: (patch: Partial<EditorSettings>) => void;
  onTool: (t: EditorTool) => void;
  map: MapData;
  selection: Selection | null;
  clipboard: MapData | null;
  onSelect: (s: Selection | null) => void;
  onCopy: (cut: boolean) => void;
  onDelete: () => void;
  lockedLayers: LayerId[];
  visibility: Record<LayerId, boolean>;
  onVisibility: (layer: LayerId) => void;
  onLayer: (layer: LayerId) => void;
  onLock: (layer: LayerId) => void;
  onRotate: () => void;
  onReset: () => void;
  canReset: boolean;
  onHelp: () => void;
}

export default function EditorPanel(p: Props) {
  const { settings: s, map } = p;
  const houseCount = map.buildings?.length ?? 0;
  const counts: Record<LayerId, number> = { terrain: map.width * map.height, trees: map.trees.length, rocks: map.rocks.length, structures: houseCount + map.structures.filter((item) => !map.buildings?.some((b) => b.x === item.x && b.y === item.y && b.w === item.w && b.h === item.h)).length, civic: map.civic?.length ?? 0, chests: map.chests.length, crypt: map.crypt?.length ?? 0 };
  const editSize = ['brush', 'structure'].includes(s.tool) || s.tool === 'eraser' && !['chests', 'civic', 'crypt'].includes(p.activeLayer);

  return <div className="editor-panel">
    <div className="sidebar-section sidebar-tools">
      <div className="section-heading"><h2>Инструменты</h2><button type="button" className="icon-btn" aria-label="Горячие клавиши" title="Горячие клавиши" onClick={p.onHelp}><Icon name="keyboard" size={17} /></button></div>
      <div className="tool-grid">
        {tools.map((tool) => <button key={tool} type="button" aria-pressed={s.tool === tool} title={`${TOOL_LABELS[tool]} (${SHORTCUTS[tool]})`} onClick={() => p.onTool(tool)} className={cn('tool-tile', s.tool === tool && 'is-active')}>
          <Icon name={tool} size={19} /><span>{TOOL_LABELS[tool]}</span>
        </button>)}
      </div>
      {editSize && <div className="brush-settings">
        <Slider label={s.tool === 'tree' || s.tool === 'rock' ? 'Размер объекта' : 'Размер кисти'} value={s.brushSize} min={1} max={12} onChange={(brushSize) => p.onSettings({ brushSize })} format={(v) => `${v} кл.`} />
        {s.tool === 'brush' && <button type="button" className="icon-btn" title="Форма кисти" aria-label="Квадратная кисть" aria-pressed={s.brushShape === 'square'} onClick={() => p.onSettings({ brushShape: s.brushShape === 'round' ? 'square' : 'round' })}><Icon name={s.brushShape === 'round' ? 'target' : 'rect'} size={16} /></button>}
      </div>}
      {s.tool === 'paste' && <p className="tool-hint">Укажите верхний левый угол вставки.</p>}
      {s.tool === 'eraser' && <p className="tool-hint">Активный слой: {LAYER_NAMES[p.activeLayer].toLowerCase()}.</p>}
    </div>

    <div className="sidebar-section props-section">
      <div className="section-heading"><h2>Объекты</h2><Icon name="chest" size={17} className="section-symbol" /></div>
      <button type="button" className={cn('chest-entry', s.tool === 'chest' && 'is-active')} title="Сундук (C)" aria-pressed={s.tool === 'chest'} onClick={() => p.onTool('chest')}>
        <span className="prop-art"><img src={artUrl(CHESTS[s.chestKind].art)} alt="" /></span>
        <span className="chest-entry-copy"><strong>Сундук</strong><span>Добавить на карту</span></span><kbd>C</kbd>
      </button>
      {s.tool === 'chest' && <div className="placement-options">
        <div className="chest-variant-grid" role="group" aria-label="Вид сундука">{CHEST_KINDS.map((kind) => <button type="button" key={kind} title={`${CHESTS[kind].label} сундук`} aria-label={`${CHESTS[kind].label} сундук`} aria-pressed={s.chestKind === kind} onClick={() => p.onSettings({ chestKind: kind })}><img src={artUrl(CHESTS[kind].art)} alt="" /><span>{CHESTS[kind].label}</span></button>)}</div>
        <button className="quiet-btn" type="button" title="Повернуть сундук (Q)" onClick={p.onRotate}><Icon name="rotate" size={15} /> Повернуть <span className="angle">{s.chestRotation}°</span></button>
        <p className="tool-hint">{p.lockedLayers.includes('chests') ? 'Слой заблокирован. Снимите замок ниже.' : !p.visibility.chests ? 'Слой скрыт. Включите видимость ниже.' : 'Кликните на карте, чтобы поставить. ПКМ по сундуку удаляет его.'}</p>
      </div>}
      <div className="prop-grid">
        {([['tree', 'oak'], ['rock', 'rock'], ['structure', null]] as const).map(([tool, art]) =>
          <button type="button" key={tool} title={`${TOOL_LABELS[tool]} (${SHORTCUTS[tool]})`} className={cn('prop-tile', s.tool === tool && 'is-active')} aria-pressed={s.tool === tool} onClick={() => p.onTool(tool)}>
            {art ? <img src={artUrl(art)} alt="" /> : <Icon name="structure" size={24} />}<span>{TOOL_LABELS[tool]}</span>
          </button>)}
      </div>
      {s.tool === 'tree' && <label className="field-label prop-kind">Вид растения<select value={s.treeKind} onChange={(e) => p.onSettings({ treeKind: e.target.value as TreeKind })}>
        {Object.entries({ oak: 'Дуб', pine: 'Сосна', bush: 'Кустарник', dead: 'Сухое дерево', cactus: 'Кактус', reed: 'Камыш', mushroom: 'Грибы' }).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
      </select></label>}
    </div>

    <div className="sidebar-section layer-section">
      <div className="section-heading"><h2>Слои</h2><Icon name="layers" size={17} className="section-symbol" /></div>
      <div className="layer-stack">
        {layerOrder.map((layer) => {
          const name = LAYER_NAMES[layer], locked = p.lockedLayers.includes(layer), visible = p.visibility[layer];
          return <div key={layer} data-layer={layer} className={cn('layer-row', p.activeLayer === layer && 'is-active', !visible && 'is-hidden')}>
            <button type="button" className="layer-name" aria-pressed={p.activeLayer === layer} onClick={() => p.onLayer(layer)}><Icon name={layerIcons[layer]} size={15} />{name}</button>
            <span className="layer-count">{counts[layer]}</span>
            {layer !== 'terrain' && <button type="button" className="layer-action" aria-label={`${visible ? 'Скрыть' : 'Показать'} слой «${name}»`} aria-pressed={visible} onClick={() => p.onVisibility(layer)}><Icon name={visible ? 'eye' : 'eyeOff'} size={15} /></button>}
            {layer === 'terrain' && <span className="layer-action" />}
            <button type="button" className="layer-action" aria-label={`${locked ? 'Разблокировать' : 'Заблокировать'} слой «${name}»`} aria-pressed={locked} onClick={() => p.onLock(layer)}><Icon name={locked ? 'lock' : 'unlock'} size={13} /></button>
          </div>;
        })}
      </div>
    </div>

    <details className="sidebar-section terrain-section">
      <summary className="section-heading"><h2>Материалы</h2><Icon name="chevron" size={15} className="section-symbol" /></summary>
      <div className="terrain-palette">
        {terrains.map((terrain) => {
          const material = TILE_ART[terrain];
          return <button key={terrain} type="button" title={TERRAIN_LABELS[terrain]} aria-label={TERRAIN_LABELS[terrain]} aria-pressed={s.terrain === terrain}
            onClick={() => { p.onSettings({ terrain }); if (!['brush', 'fill', 'rect'].includes(s.tool)) p.onTool('brush'); }}
            style={{ backgroundColor: `rgb(${TERRAIN_COLORS[terrain].join(',')})`, backgroundImage: material ? `url(${artUrl(material)})` : undefined }} />;
        })}
      </div>
      <div className="palette-status"><span>{TERRAIN_LABELS[s.terrain]}</span><button title="Пипетка (I)" type="button" className="icon-btn" aria-pressed={s.tool === 'pick'} onClick={() => p.onTool('pick')}><Icon name="pick" size={16} /></button></div>
      {s.terrain === 'door' && <label className="field-label">Вид двери<select aria-label="Вид двери" value={s.doorKind ?? 'normal'} onChange={(e) => p.onSettings({ doorKind: e.target.value as DoorKind })}>
        {DOOR_KINDS.map((kind) => <option key={kind} value={kind}>{DOOR_KIND_LABELS[kind]}</option>)}
      </select><span className="tool-hint">Кисть и область ставят выбранный вид; кистью по готовой двери можно сменить её вид.</span></label>}
    </details>

    {(s.tool === 'select' || !!p.selection || !!p.clipboard) && <div className="sidebar-section selection-section">
      <div className="section-heading"><h2>Выделение</h2><Icon name="select" size={16} /></div>
      {p.selection ? <p className="tool-hint">{p.selection.w} × {p.selection.h} клеток. Esc отменяет выделение.</p> : <p className="tool-hint">Протяните по карте, чтобы выделить область.</p>}
      <div className="selection-actions">
        <button title="Копировать (Ctrl+C)" type="button" className="icon-btn" disabled={!p.selection} onClick={() => p.onCopy(false)}><Icon name="copy" size={17} /></button>
        <button title="Вырезать (Ctrl+X)" type="button" className="icon-btn" disabled={!p.selection} onClick={() => p.onCopy(true)}><Icon name="scissors" size={17} /></button>
        <button title="Вставить (Ctrl+V)" type="button" className="icon-btn" disabled={!p.clipboard} onClick={() => p.onTool('paste')}><Icon name="paste" size={17} /></button>
        <button title="Удалить выделение" type="button" className="icon-btn" disabled={!p.selection} onClick={p.onDelete}><Icon name="trash" size={17} /></button>
        <button title="Снять выделение" type="button" className="icon-btn" disabled={!p.selection} onClick={() => p.onSelect(null)}><Icon name="x" size={17} /></button>
      </div>
    </div>}
    <div className="sidebar-section sidebar-bottom"><button type="button" className="quiet-btn" disabled={!p.canReset} onClick={p.onReset}><Icon name="reset" size={14} /> Сбросить ручные правки</button></div>
  </div>;
}