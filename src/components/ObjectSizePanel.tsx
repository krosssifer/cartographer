import { useEffect, useState } from 'react';
import { CHESTS, CHEST_KINDS } from '../lib/chests';
import { artUrl } from '../lib/assets';
import { MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, roundedSize } from '../lib/objectGeometry';
import type { ChestKind, EditorSettings, ObjectDimensions } from '../lib/types';
import Icon from './Icon';

interface Props {
  label: string;
  size: ObjectDimensions;
  defaultSize: ObjectDimensions;
  selected: boolean;
  integer?: boolean;
  locked: boolean;
  settings: EditorSettings;
  kind?: ChestKind;
  onSettings: (patch: Partial<EditorSettings>) => void;
  onPreview: (size: ObjectDimensions, kind?: ChestKind) => string | undefined;
  onApply: (size: ObjectDimensions, kind?: ChestKind) => void;
  onReset: () => void;
  onClose: () => void;
  onRotate?: (degrees: number) => string | undefined;
}

export default function ObjectSizePanel(p: Props) {
  const [action, setAction] = useState<string>();
  const [draft, setDraft] = useState<ObjectDimensions>({ w: roundedSize(p.size.w), h: roundedSize(p.size.h) });
  const [kind, setKind] = useState(p.kind);
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const ratio = p.size.w / p.size.h;
  const factor = p.settings.sizeUnit === 'feet' ? 5 : 1;
  const [inputs, setInputs] = useState({ w: String(roundedSize(p.size.w * factor)), h: String(roundedSize(p.size.h * factor)) });
  const min = p.integer ? 2 : MIN_OBJECT_SIZE;
  const quantize = (n: number) => p.integer ? Math.round(n) : roundedSize(n);

  function change(next: ObjectDimensions, nextKind = kind, source?: { axis: 'w' | 'h'; raw: string }) {
    const value = { w: quantize(next.w), h: quantize(next.h) };
    if ([value.w, value.h].some((n) => !Number.isFinite(n) || n < min || n > MAX_OBJECT_SIZE)) {
      setInvalid(true); setError(`Допустимый размер: ${min * factor}–${MAX_OBJECT_SIZE * factor} ${factor === 5 ? 'футов' : 'клеток'}.`);
      return;
    }
    setInvalid(false); setDraft(value); setKind(nextKind);
    setInputs({ w: source?.axis === 'w' ? source.raw : String(roundedSize(value.w * factor)), h: source?.axis === 'h' ? source.raw : String(roundedSize(value.h * factor)) });
    const err = p.onPreview(value, nextKind);
    if (err) setInvalid(true);
    setError(err);
  }

  useEffect(() => { setInputs({ w: String(roundedSize(draft.w * factor)), h: String(roundedSize(draft.h * factor)) }); }, [factor]);
  const message = p.locked ? 'Слой заблокирован. Разблокируйте его для редактирования.' : error ?? action;
  const spin = (degrees: number) => {
    if (!p.onRotate) return;
    const problem = p.onRotate(degrees);
    setAction(problem);
  };
  return <section className="sidebar-section object-size-panel" aria-label="Размер объекта">
    <div className="section-heading"><h2><Icon name="resize" size={16} /> Размер объекта</h2><button type="button" className="icon-btn" aria-label={p.selected ? 'Снять выбор объекта' : 'Закрыть размер'} onClick={p.onClose}><Icon name="x" size={14} /></button></div>
    <div className="size-subject"><span>{p.label}</span><small>{p.selected ? 'На карте' : 'Новый объект'}</small></div>
    {p.kind && <div className="size-chest-variants" role="group" aria-label="Вид выбранного сундука">{CHEST_KINDS.map((id) => <button type="button" key={id} title={CHESTS[id].label} aria-label={`${CHESTS[id].label} сундук`} aria-pressed={kind === id} onClick={() => change(draft, id)}><img src={artUrl(CHESTS[id].art)} alt="" /></button>)}</div>}
    <div className="dimension-fields">
      {(['w', 'h'] as const).map((axis) => <label key={axis}>{axis === 'w' ? 'Ширина' : 'Высота'}
        <input type="number" aria-label={axis === 'w' ? 'Ширина объекта' : 'Высота объекта'} min={min * factor} max={MAX_OBJECT_SIZE * factor} step={p.integer ? factor : factor * .1} value={inputs[axis]}
          onChange={(e) => {
            const n = Number(e.currentTarget.value) / factor;
            const raw = e.currentTarget.value;
            setInputs((old) => ({ ...old, [axis]: raw }));
            if (e.currentTarget.value === '') { setInvalid(true); return; }
            const next = { ...draft, [axis]: n };
            if (p.settings.sizeLock) { if (axis === 'w') next.h = n / ratio; else next.w = n * ratio; }
            change(next, kind, { axis, raw });
          }} onKeyDown={(e) => { if (e.key === 'Enter' && !p.locked && !error && !invalid) p.onApply(draft, kind); }} />
      </label>)}
      <button type="button" className="icon-btn aspect-lock" aria-label="Сохранять пропорции" aria-pressed={p.settings.sizeLock} title="Сохранять пропорции" onClick={() => p.onSettings({ sizeLock: !p.settings.sizeLock })}><Icon name={p.settings.sizeLock ? 'link' : 'unlock'} size={16} /></button>
    </div>
    <div className="size-units"><span>{roundedSize(draft.w * 5)} × {roundedSize(draft.h * 5)} футов</span><select aria-label="Единицы размера" value={p.settings.sizeUnit} onChange={(e) => p.onSettings({ sizeUnit: e.target.value === 'feet' ? 'feet' : 'cells' })}><option value="cells">Клетки</option><option value="feet">Футы</option></select></div>
    <div className="size-presets" role="group" aria-label="Масштаб объекта">{[.5, 1, 1.5, 2].map((scale) => <button type="button" key={scale} onClick={() => change({ w: p.size.w * scale, h: p.size.h * scale })}>×{scale}</button>)}<button type="button" aria-label="Сбросить размер" title="Сбросить размер" onClick={() => { setDraft(p.defaultSize); setInputs({ w: String(roundedSize(p.defaultSize.w * factor)), h: String(roundedSize(p.defaultSize.h * factor)) }); setKind(p.kind); setError(undefined); setInvalid(false); p.onReset(); }}><Icon name="reset" size={13} /></button></div>
    {p.selected && p.onRotate && <div className="object-actions">
      <div className="object-actions-title">Положение</div>
      <div className="rotate-actions">
        <button type="button" className="quiet-btn" disabled={p.locked} onClick={() => spin(180)}><Icon name="rotate" size={15} /> Повернуть на 180°</button>
        <button type="button" className="quiet-btn" disabled={p.locked} onClick={() => spin(90)}><Icon name="rotate" size={15} /> 90°</button>
      </div>
      <p className="tool-hint">Зажмите левую кнопку мыши на предмете и потяните, чтобы переместить.</p>
    </div>}
    <button type="button" className="action-btn plan-apply size-apply" disabled={p.locked || !!error || invalid} onClick={() => p.onApply(draft, kind)}><Icon name="check" size={15} /> {p.selected ? 'Применить к объекту' : 'Использовать размер'}</button>
    <p className={message ? 'tool-hint size-error' : 'tool-hint'} role={message ? 'status' : undefined}>{message ?? (p.selected ? 'Изменение можно отменить. Размер задан до поворота.' : 'Для уже поставленных объектов: V → клик по предмету.')}</p>
  </section>;
}