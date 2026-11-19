import { cn } from '../utils/cn';

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  return (
    <label className="range-field">
      <span className="range-text">
        <span title={hint}>{label}</span>
        <span aria-hidden="true">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="switch-field"
    >
      <span>{label}</span>
      <span className={cn('toggle-switch', checked && 'is-active')} />
    </button>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
