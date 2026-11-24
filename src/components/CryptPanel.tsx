import { useState } from 'react';
import { artUrl } from '../lib/assets';
import { CRYPT, CRYPT_GROUP_COUNTS, CRYPT_GROUPS, CRYPT_KINDS, CRYPT_PLACEMENT_LABEL, CRYPT_THEMES, cryptArt, type CryptGroup } from '../lib/cryptKit';
import { CRYPT_HALL_THEME, cryptRoomCapacity } from '../lib/cryptLayout';
import { CHESTS, CHEST_KINDS } from '../lib/chests';
import type { ChestKind, CryptRoom, EditorSettings, GenSettings, MapData, RenderSettings } from '../lib/types';
import Icon from './Icon';
import { Slider, Toggle, pct } from './controls';

export type CryptSettings = Pick<GenSettings, 'cryptDetail' | 'cryptTraps' | 'cryptChasms'>;
const groups = Object.keys(CRYPT_GROUPS) as CryptGroup[];
const groupIcons: Record<CryptGroup, string> = { hazards: 'trap', burial: 'coffin', relics: 'sparkles', furnishings: 'chair' };
const roomWord = (count: number) => {
  const last = count % 10, teen = count % 100;
  if (last === 1 && teen !== 11) return 'зал';
  return last >= 2 && last <= 4 && (teen < 12 || teen > 14) ? 'зала' : 'залов';
};

export function CryptOptions({ settings, onChange }: { settings: CryptSettings; onChange: (patch: Partial<CryptSettings>) => void }) {
  return <>
    <Slider label="Насыщенность деталями" value={settings.cryptDetail} min={0} max={1} step={.05} format={pct} onChange={(cryptDetail) => onChange({ cryptDetail })} />
    <Toggle label="Автоматические ловушки" checked={settings.cryptTraps} onChange={(cryptTraps) => onChange({ cryptTraps })} />
    <Toggle label="Пропасти и провалы" checked={settings.cryptChasms} onChange={(cryptChasms) => onChange({ cryptChasms })} />
  </>;
}

function CryptPlan({ gen, locked, onApply }: { gen: GenSettings; locked: boolean; onApply: (value: CryptSettings) => void }) {
  const [draft, setDraft] = useState<CryptSettings>({ cryptDetail: gen.cryptDetail, cryptTraps: gen.cryptTraps, cryptChasms: gen.cryptChasms });
  return <details className="sidebar-section generation-fields crypt-plan">
    <summary className="section-heading"><h2>Авторасстановка</h2><Icon name="chevron" size={15} /></summary>
    {!gen.dungeonWallsOnly && <CryptOptions settings={draft} onChange={(patch) => setDraft((old) => ({ ...old, ...patch }))} />}
    <button type="button" className="action-btn plan-apply" disabled={locked || gen.dungeonWallsOnly} onClick={() => onApply(draft)}><Icon name="sparkles" size={15} /> Обставить склеп заново</button>
    <p className="tool-hint">{gen.dungeonWallsOnly ? 'В режиме «Только стены» предметы добавляются вручную.' : locked ? 'Разблокируйте слой объектов склепа.' : 'Стены и объекты, поставленные вручную, сохранятся.'}</p>
  </details>;
}

interface Props {
  map: MapData;
  gen: GenSettings;
  settings: EditorSettings;
  render: RenderSettings;
  locked: boolean;
  room?: CryptRoom;
  onApply: (value: CryptSettings) => void;
  onCreate: () => void;
  onView: (room: CryptRoom) => void;
  onTool: (patch: Partial<EditorSettings>) => void;
  onSettings: (patch: Partial<EditorSettings>) => void;
  onRender: (patch: Partial<RenderSettings>) => void;
  onRotate: () => void;
  onChest: (kind: ChestKind) => void;
}

export default function CryptPanel(p: Props) {
  const { map, gen, settings, render } = p;
  const [group, setGroup] = useState<CryptGroup>(() => settings.tool === 'crypt' ? CRYPT[settings.cryptKind].group : 'burial');
  const dungeon = map.biome === 'dungeon';
  const placedRooms = map.cryptRooms?.length ?? 0;
  const roomCapacity = cryptRoomCapacity(gen.width, gen.height);
  const roomsShort = placedRooms < gen.rooms;
  const roomsShortHint = roomCapacity < gen.rooms
    ? `На карте помещается ${roomCapacity} ${roomWord(roomCapacity)} из ${gen.rooms} — увеличьте карту или уменьшите количество комнат.`
    : `Разместилось ${placedRooms} ${roomWord(placedRooms)} из ${gen.rooms} — уменьшите количество комнат или увеличьте карту.`;
  const hallTheme = CRYPT_HALL_THEME[gen.cryptArchetype] ?? 'sanctum';
  const room = p.room ?? map.cryptRooms?.find(({ theme }) => theme === hallTheme) ?? map.cryptRooms?.[0];
  const active = settings.tool === 'crypt';
  const summary = CRYPT[settings.cryptKind];
  const traps = map.crypt?.filter((p) => CRYPT[p.kind].secret).length ?? 0;
  return <div className="crypt-panel">
    <section className="sidebar-section crypt-overview" aria-label="Обзор склепа">
      <div className="section-heading"><h2><Icon name="crypt" size={18} /> Каменный склеп</h2><span className="plot-count">{dungeon && <>Залы {placedRooms} из {gen.rooms}<br /></>}{map.crypt?.length ?? 0} на карте</span></div>
      {!dungeon ? <>
        <p className="tool-hint">Создайте карту с усыпальницами, святилищем и тайниками. Текущий проект можно вернуть отменой.</p>
        <button type="button" className="action-btn plan-apply" onClick={p.onCreate}><Icon name="sparkles" size={16} /> Создать склеп</button>
      </> : <>
        {roomsShort && <p className="tool-hint">{roomsShortHint}</p>}
        <div className="crypt-room-info"><span><Icon name="target" size={16} />{room ? CRYPT_THEMES[room.theme] : 'Нет выбранного зала'}</span>{room && <button type="button" className="quiet-btn" onClick={() => p.onView(room)}>Найти</button>}</div>
        {(map.cryptRooms?.length ?? 0) > 1 && <label className="field-label crypt-room-select">Залы<select aria-label="Зал склепа" value={room ? `${room.x}:${room.y}` : ''} onChange={(event) => {
          const next = map.cryptRooms?.find((item) => `${item.x}:${item.y}` === event.target.value); if (next) p.onView(next);
        }}>{map.cryptRooms?.map((item, i) => <option key={`${item.x}:${item.y}`} value={`${item.x}:${item.y}`}>{String(i + 1).padStart(2, '0')} · {CRYPT_THEMES[item.theme]}</option>)}</select></label>}
        <div className="crypt-visibility"><Toggle label="Объекты склепа" checked={render.showCrypt} onChange={(showCrypt) => p.onRender({ showCrypt })} />
          <Toggle label={`Метки ловушек${traps ? ` · ${traps}` : ''}`} checked={render.showSecrets} onChange={(showSecrets) => p.onRender({ showSecrets })} /></div>
      </>}
    </section>

    <section className="sidebar-section crypt-library" aria-label="Библиотека склепа">
      <div className="section-heading"><h2>Объекты склепа</h2><button type="button" className="icon-btn" title="Ластик объектов склепа" aria-label="Ластик объектов склепа" aria-pressed={active && settings.cryptErase} onClick={() => p.onTool({ cryptErase: !active || !settings.cryptErase })}><Icon name="eraser" size={16} /></button></div>
      <div className="crypt-filters" role="group" aria-label="Категория объектов склепа">
        {groups.map((item) => <button type="button" aria-pressed={group === item} key={item} onClick={() => setGroup(item)}><Icon name={groupIcons[item]} size={13} /> {CRYPT_GROUPS[item]}</button>)}
      </div>
      <div className="furniture-grid crypt-grid">
        {CRYPT_KINDS.filter((item) => CRYPT[item].group === group).map((item) => <button type="button" key={item} title={`${CRYPT[item].label} — ${CRYPT[item].purpose}`} aria-label={CRYPT[item].label}
          aria-pressed={active && !settings.cryptErase && settings.cryptKind === item} onClick={() => p.onTool({ cryptKind: item, cryptErase: false })}><img src={artUrl(cryptArt(item))} alt="" /><span>{CRYPT[item].label}</span></button>)}
      </div>
      <div className="crypt-category-counts">{CRYPT_GROUP_COUNTS.map((entry) => <span key={entry.group}>{CRYPT_GROUPS[entry.group]} <b>{entry.count}</b></span>)}</div>
      <p className="tool-hint"><b>{CRYPT[settings.cryptKind].label}</b> — {CRYPT[settings.cryptKind].purpose}. Такие предметы ставятся {CRYPT_PLACEMENT_LABEL[CRYPT[settings.cryptKind].placement ?? 'any']}.</p>
      <div className="crypt-stamp-row"><span>{active && settings.cryptErase ? 'Удаление объектов' : active ? summary.label : 'Выберите объект'}</span>
        {active && !settings.cryptErase && <button type="button" className="quiet-btn" title="Повернуть объект (Q)" onClick={p.onRotate}><Icon name="rotate" size={14} /> {settings.stampRotation}°</button>}</div>
      {active && !settings.cryptErase && summary.secret && <Toggle label="Скрывать от игроков" checked={settings.cryptConceal} onChange={(cryptConceal) => p.onSettings({ cryptConceal })} />}
      {active && !settings.cryptErase && (settings.cryptKind === 'bridge' || settings.cryptKind === 'grate') && <p className="tool-hint">Размещайте поверх пропасти или провала.</p>}
    </section>
    <details className="sidebar-section crypt-chests"><summary className="section-heading"><h2><Icon name="chest" size={16} /> Сундуки</h2><Icon name="chevron" size={14} /></summary>
      <div className="chest-variant-grid">{CHEST_KINDS.map((kind) => <button type="button" key={kind} title={`${CHESTS[kind].label} сундук`} onClick={() => p.onChest(kind)}><img src={artUrl(CHESTS[kind].art)} alt="" /><span>{CHESTS[kind].label}</span></button>)}</div>
    </details>
    {dungeon && <CryptPlan gen={gen} locked={p.locked} onApply={p.onApply} key={`${gen.seed}:${gen.cryptDetail}:${gen.cryptTraps}:${gen.cryptChasms}`} />}
  </div>;
}