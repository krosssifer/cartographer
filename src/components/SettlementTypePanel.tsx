import type { GenSettings, MapData } from '../lib/types';
import { resolveSettlementLayout } from '../lib/gen/settlementPlanner';
import {
  DISTRICTS,
  SETTLEMENT_LAYOUT_IDS,
  SETTLEMENT_LAYOUT_LABELS,
  SETTLEMENT_TYPES,
  URBAN_CHARACTER_IDS,
  URBAN_CHARACTERS,
  getSettlementType,
  getUrbanCharacter,
  isSettlementLayout,
  isUrbanCharacter,
} from '../lib/gen/settlementTypes';

interface Props {
  gen: GenSettings;
  map: MapData;
  onGen: (patch: Partial<GenSettings>) => void;
}

const WALL_LABELS = { none: 'без стен', palisade: 'частокол', stone: 'каменная стена' } as const;
const GEOGRAPHY_LABELS = { plain: 'равнина', coast: 'побережье', mountain: 'склон горы' } as const;

/**
 * Тип поселения, планировка улиц и исторический характер города.
 * «Классическое» — прежний генератор (деревня/город); тип включает
 * градостроительный планировщик кварталов, участков, стен и географии.
 */
export function SettlementTypeOptions({ gen, map, onGen }: Props) {
  const type = getSettlementType(gen.settlementType);
  const report = map.plan?.settlement;
  const layout = type ? resolveSettlementLayout(type, gen.settlementLayout) : undefined;
  const defaultChar = type ? getUrbanCharacter(undefined, type) : undefined;
  return <>
    <label className="field-label">Тип поселения<select aria-label="Тип поселения" value={type?.id ?? 'classic'}
      onChange={(e) => {
        const next = getSettlementType(e.target.value);
        onGen(next
          ? { settlementType: next.id, settlementLayout: undefined, settlementCharacter: undefined, biome: next.style, settlement: next.style }
          : { settlementType: undefined, settlementLayout: undefined, settlementCharacter: undefined });
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
      <label className="field-label">Характер города<select aria-label="Характер города" value={isUrbanCharacter(gen.settlementCharacter) ? gen.settlementCharacter : 'auto'}
        onChange={(e) => onGen({ settlementCharacter: e.target.value === 'auto' ? undefined : e.target.value })}>
        <option value="auto">По типу — {defaultChar?.label.toLowerCase()}</option>
        {URBAN_CHARACTER_IDS.map((id) => <option key={id} value={id}>{URBAN_CHARACTERS[id].label}</option>)}
      </select></label>
      {report && report.type === type.id && report.layout === layout && <p className="scene-report">
        {GEOGRAPHY_LABELS[report.geography]}{report.river ? ', река' : ''} · {WALL_LABELS[report.walls]}{report.walls !== 'none' ? `, ворот ${report.gates}, башен ${report.towers}` : ''}<br />
        Улиц {report.streets}{report.bridges ? ` · мостов ${report.bridges}` : ''}{report.piers ? ` · причалов ${report.piers}` : ''}
        {report.landmarks?.length ? ` · ориентиров ${report.landmarks.length}` : ''}
        {report.quality ? ` · качество ${report.quality.score}/100` : ''}<br />
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
