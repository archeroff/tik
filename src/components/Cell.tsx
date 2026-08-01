import type { CellValue } from '../types';

interface CellProps {
  value: CellValue;
  disabled: boolean;
  highlighted: boolean;
  onClick: () => void;
}

export function Cell({ value, disabled, highlighted, onClick }: CellProps) {
  const classes = ['cell'];
  if (value) classes.push(`cell--${value.toLowerCase()}`);
  if (highlighted) classes.push('cell--win');

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={value ? `Cell filled with ${value}` : 'Empty cell'}
    >
      {value ?? ''}
    </button>
  );
}
