import type { GenSettings, MapData } from '../lib/types';
import { resolveSettlementLayout } from '../lib/gen/settlementPlanner';
import {
  DISTRICTS,
  SETTLEMENT_LAYOUT_IDS,
  SETTLEMENT_LAYOUT_LABELS,
  SETTLEMENT_TYPES,
  getSettlementType,
  isSettlementLayout,
} from '../lib/gen/settlementTypes';

interface Props {
  gen: GenSettings;
  map: MapData;
  onGen: (patch: Partial<GenSettings>) => void;
}

const WALL_LABELS = { none: 'без стен', palisade: 'частокол', stone: 'каменная стена' } as const;
const GEOGRAPHY_LABELS = { plain: 'равнина', coast: 'побережье', mountain: 'склон горы' } as const;

/**
 * Тип поселения и планировка улиц. «Классическое» — прежний генератор
 * (деревня/город); тип включает планировщик кварталов, стен и географии.
 * Остальное — кварталы, ворота, причалы — выбирается автоматически.
 */
export function SettlementTypeOptions({ gen, map, onGen }: Props) {
  const type = getSettlementType(gen.settlementType);
  const report = map.plan?.settlement;
  const layout = type ? resolveSettlementLayout(type, gen.settlementLayout) : undefined;
  return <>
    <label className="field-label">Тип поселения<select aria-label="Тип поселения" value={type?.id ?? 'classic'}
      onChange={(e) => {
        const next = getSettlementType(e.target.value);
        onGen(next ? { settlementType: next.id, settlementLayout: undefined, biome: next.style, settlement: next.style } : { settlementType: undefined, settlementLayout: undefined });
      }}>
      <option value="classic">Классическое — деревня или город</option>
      {SETTLEMENT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {type && <>
      <p className="tool-hint">{type.description}</p>
      <label className="field-label">Планировка улиц<select aria-label="Планировка улиц" value={isSettlementLayout(gen.settlementLayout) ? gen.settlementLayout : 'auto'}
        onChange={(e) => onGen({ settlementLayout: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По типу — {SETTLEMENT_LAYOUT_LABELS[type.layouts[0]].toLowerCase()}</option>
        {SETTLEMENT_LAYOUT_IDS.map((id) => <option key={id} value={id}>{SETTLEMENT_LAYOUT_LABELS[id]}{type.layouts.includes(id) ? '' : ' (нетипично)'}</option>)}
      </select></label>
      {report && report.type === type.id && report.layout === layout && <p className="scene-report">
        {GEOGRAPHY_LABELS[report.geography]}{report.river ? ', река' : ''} · {WALL_LABELS[report.walls]}{report.walls !== 'none' ? `, ворот ${report.gates}, башен ${report.towers}` : ''}<br />
        Улиц {report.streets}{report.bridges ? ` · мостов ${report.bridges}` : ''}{report.piers ? ` · причалов ${report.piers}` : ''}<br />
        Кварталы: {summarizeDistricts(report.districts)}
        {report.notes.length > 0 && <><br />{report.notes.join('; ')}</>}
      </p>}
    </>}
  </>;
}

function summarizeDistricts(districts: { kind: keyof typeof DISTRICTS; buildings: number }[]): string {
  const totals = new Map<string, number>();
  for (const district of districts) totals.set(DISTRICTS[district.kind].label, (totals.get(DISTRICTS[district.kind].label) ?? 0) + district.buildings);
  return [...totals].map(([label, count]) => `${label.toLowerCase()} ${count}`).join(', ');
}
