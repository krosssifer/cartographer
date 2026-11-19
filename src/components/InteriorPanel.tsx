import { useRef, useState } from 'react';
import { artUrl } from '../lib/assets';
import { FURNITURE, FURNITURE_FINISHES, FURNITURE_FINISH_KEYS, FURNITURE_GROUPS, FURNITURE_KINDS, furnitureArt, type FurnitureGroup } from '../lib/furnitureKit';
import { MAX_SPRITES } from '../lib/furnitureImport';
import { interiorOf, ROOM_NAMES, tavernName } from '../lib/interiors';
import type { Building, EditorSettings, FurnitureKind, MapData } from '../lib/types';
import Icon from './Icon';

interface Props {
  map: MapData;
  seed: number;
  selected: Building | undefined;
  settings: EditorSettings;
  roofs: boolean;
  onPick: (patch: Partial<EditorSettings>) => void;
  onSettings: (patch: Partial<EditorSettings>) => void;
  onImport: (file: File, kind: FurnitureKind) => void;
  onInspect: () => void;
  onView: (b: Building) => void;
  onRoofs: () => void;
  onRotate: () => void;
}

export default function InteriorPanel({ map, seed, selected, settings, roofs, onPick, onSettings, onImport, onInspect, onView, onRoofs, onRotate }: Props) {
  const [group, setGroup] = useState<FurnitureGroup>(() => FURNITURE[settings.furnitureKind].group);
  const [assetKind, setAssetKind] = useState<FurnitureKind>(settings.furnitureKind);
  const input = useRef<HTMLInputElement>(null);
  const tavern = map.buildings?.find((b) => b.kind === 'tavern');
  const building = selected ?? tavern ?? map.buildings?.[0];
  const plan = building ? interiorOf(building) : undefined;
  const model = settings.tool === 'furniture';
  const dimensions = building ? `${building.w} × ${building.h} клеток` : '';
  return <div className="interior-panel">
    <section className="sidebar-section inner-heading" aria-label="Обзор интерьеров">
      <div className="section-heading"><h2><Icon name="interior" size={17} /> План помещений</h2><button type="button" className="icon-btn interior-view-toggle" title={roofs ? 'Открыть интерьеры' : 'Закрыть интерьеры'} aria-label={roofs ? 'Открыть интерьеры' : 'Закрыть интерьеры'} aria-pressed={!roofs} onClick={onRoofs}><Icon name={roofs ? 'eyeOff' : 'eye'} size={16} /></button></div>
      {building && plan ? <>
        <div className="interior-subject">
          <div className="interior-emblem"><Icon name={building.kind === 'tavern' ? 'mug' : 'home'} size={24} /></div>
          <div>
            <div className="interior-type">{building.kind === 'tavern' ? 'Таверна' : 'Постройка'}</div>
            <h3>{building.kind === 'tavern' ? `«${tavernName(building, seed)}»` : building.kind === 'shop' ? 'Торговый дом' : 'Жилой дом'}</h3>
            <div className="interior-measure">{dimensions} · {plan.furnishings.length} предметов</div>
          </div>
        </div>
        <div className="interior-links">
          <button type="button" className="quiet-btn" onClick={() => onView(building)}><Icon name="target" size={15} /> {building.kind === 'tavern' ? 'Найти таверну' : 'Показать на карте'}</button>
          {!!tavern && tavern !== building && <button type="button" className="quiet-btn" onClick={() => onView(tavern)}><Icon name="mug" size={14} /> Таверна</button>}
          <button type="button" className="icon-btn inspect-house" title="Выбрать дом на карте" aria-label="Выбрать дом на карте" onClick={onInspect}><Icon name="select" size={16} /></button>
        </div>
        <ul className="room-list">
          {plan.rooms.map((room, i) => <li key={`${room.kind}:${i}`}><span className="room-index">{String(i + 1).padStart(2, '0')}</span><span>{ROOM_NAMES[room.kind]}</span><span className="room-area">{Math.round(room.w * room.h)} кл.</span></li>)}
        </ul>
      </> : <p className="tool-hint">Сначала добавьте дом или создайте поселение с застройкой.</p>}
    </section>
    <section className="sidebar-section furnishing-section" aria-label="Библиотека мебели">
      <div className="section-heading"><h2><Icon name="chair" size={17} /> Мебель</h2>
        <button type="button" className="icon-btn" title="Удалить мебель" aria-label="Удалить мебель" aria-pressed={model && settings.furnitureErase} onClick={() => onPick({ furnitureErase: !model || !settings.furnitureErase })}><Icon name="eraser" size={16} /></button>
      </div>
      <div className="furniture-filters" role="group" aria-label="Категория мебели">
        {(Object.keys(FURNITURE_GROUPS) as FurnitureGroup[]).map((kind) => <button type="button" key={kind} aria-pressed={kind === group} onClick={() => setGroup(kind)}>{FURNITURE_GROUPS[kind]}</button>)}
      </div>
      <div className="furniture-grid">
        {FURNITURE_KINDS.filter((item) => FURNITURE[item].group === group).map((kind) => <button type="button" key={kind} title={FURNITURE[kind].label} aria-label={FURNITURE[kind].label}
          aria-pressed={model && !settings.furnitureErase && !settings.furnitureSprite && settings.furnitureKind === kind} onClick={() => onPick({ furnitureKind: kind, furnitureSprite: '', furnitureErase: false })}>
          <img src={artUrl(furnitureArt(kind))} alt="" style={{ filter: FURNITURE_FINISHES[settings.furnitureFinish].filter }} /><span>{FURNITURE[kind].label}</span>
        </button>)}
      </div>
      <div className="furniture-finishes" role="group" aria-label="Отделка мебели">
        <span>Отделка</span>{FURNITURE_FINISH_KEYS.map((finish) => <button key={finish} type="button" aria-label={FURNITURE_FINISHES[finish].label}
          aria-pressed={settings.furnitureFinish === finish} title={FURNITURE_FINISHES[finish].label} style={{ backgroundColor: FURNITURE_FINISHES[finish].color }}
          onClick={() => onSettings({ furnitureFinish: finish })} />)}
      </div>
      <div className="furniture-help"><span>{model && settings.furnitureErase ? 'Кликните по предмету, чтобы убрать его.' : model ? 'Кликните по свободному месту в комнате.' : 'Выберите предмет и разместите его в комнате.'}</span>
        {model && !settings.furnitureErase && <button type="button" className="quiet-btn" title="Повернуть мебель (Q)" onClick={onRotate}><Icon name="rotate" size={15} /> {settings.stampRotation}°</button>}
      </div>
    </section>
    <details className="sidebar-section custom-furniture">
      <summary className="section-heading"><h2><Icon name="upload" size={17} /> Свои спрайты</h2><span className="room-area">{map.furnitureSprites?.length ?? 0}/{MAX_SPRITES}</span></summary>
      <p className="tool-hint">PNG или WebP с прозрачным фоном. Файл хранится в проекте и не отправляется на сервер.</p>
      <label className="field-label custom-kind">Размер по типу<select value={assetKind} aria-label="Тип импортируемой мебели" onChange={(e) => setAssetKind(e.target.value as FurnitureKind)}>
        {FURNITURE_KINDS.map((kind) => <option key={kind} value={kind}>{FURNITURE[kind].label}</option>)}</select></label>
      <input ref={input} type="file" hidden accept="image/png,image/webp,.png,.webp" aria-label="Выбрать спрайт мебели" onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file, assetKind); e.target.value = ''; }} />
      <button type="button" className="action-btn plan-apply" onClick={() => input.current?.click()}><Icon name="upload" size={15} /> Импортировать PNG / WebP</button>
      {!!map.furnitureSprites?.length && <div className="furniture-grid custom-furniture-grid">
        {map.furnitureSprites.map((sprite) => <button type="button" key={sprite.id} title={sprite.label} aria-pressed={model && !settings.furnitureErase && settings.furnitureSprite === sprite.id}
          onClick={() => onPick({ furnitureSprite: sprite.id, furnitureKind: sprite.kind, furnitureErase: false })}><img src={sprite.data} alt="" /><span>{sprite.label}</span></button>)}
      </div>}
    </details>
  </div>;
}