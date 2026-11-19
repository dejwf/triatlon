/** Společné komponenty veřejné tabule a kiosku: pruh rozložení času, odznak D/H, QR kód. */
import { doneMs, estimatedRestMs, type BoardRow, type Locality } from '@triatlon/shared';
import qrcode from 'qrcode-generator';
import { disciplineVar } from './board-utils';

export function LocBadge({ locality }: { locality: Locality }) {
  const local = locality === 'local';
  return (
    <span className={`loc-badge ${local ? 'local' : 'guest'}`} title={local ? 'Domácí' : 'Host'}>
      {local ? 'D' : 'H'}
    </span>
  );
}

/**
 * Pruh rozložení času: úseky plavání → kolo → běh ve společném měřítku kategorie. Na trati je
 * zbytek přerušovaný (odhad podle mediánu dokončených), u DNF jen hotové úseky.
 */
export function DisciplineBar({
  row,
  scale,
  medians,
  className = '',
}: {
  row: BoardRow;
  scale: number;
  medians: (number | null)[];
  className?: string;
}) {
  const pct = (ms: number) => `${Math.min(100, (ms / scale) * 100).toFixed(2)}%`;
  const rest = estimatedRestMs(row, medians);
  return (
    <span className={`dbar ${className}`} aria-hidden="true">
      {row.disciplinesMs.map((ms, i) =>
        ms == null ? null : (
          <span key={i} style={{ width: pct(ms), background: disciplineVar(i) }} />
        ),
      )}
      {rest != null && rest > 0 && (
        <span className="rest" style={{ width: pct(Math.min(rest, scale - doneMs(row))) }} />
      )}
    </span>
  );
}

export function DisciplineLegend({ names }: { names: string[] }) {
  return (
    <div className="legend">
      {names.map((n, i) => (
        <span key={n}>
          <span className="swatch" style={{ background: disciplineVar(i) }} />
          {n}
        </span>
      ))}
      <span>
        <span className="swatch rest" />
        Na trati (odhad)
      </span>
    </div>
  );
}

/** QR kód jako SVG (bez externí služby — kód se generuje v prohlížeči). */
export function QrCode({ text, size }: { text: string; size: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      role="img"
      aria-label={`QR kód s odkazem ${text}`}
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#0e1114" />
    </svg>
  );
}
