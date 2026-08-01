import type { CellValue } from '../types';
import { Cell } from './Cell';

interface BoardProps {
  board: CellValue[];
  winningLine: number[];
  enabled: boolean;
  onCellClick: (index: number) => void;
}

export function Board({ board, winningLine, enabled, onCellClick }: BoardProps) {
  return (
    <ol className="board" aria-label="Tic-tac-toe board">
      {board.map((value, index) => (
        <li key={index} className="board__cell">
          <Cell
            value={value}
            disabled={!enabled || value !== null}
            highlighted={winningLine.includes(index)}
            onClick={() => onCellClick(index)}
          />
        </li>
      ))}
    </ol>
  );
}
