// Small SVG charts drawn on the server: no chart library, so the dashboard stays light on slow
// internet. Hovering a bar or point shows its values (SVG <title>); every chart has a legend for
// two series and a "Show as table" view, so nothing depends on color alone.

import { formatMoney } from "@/lib/format";

export type Series = { name: string; color: string };

const W = 600;
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

/** Rupees in short form for axes: 950, 12k, 2.5L (lakh), 1.2Cr. */
export function shortRupees(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  const fmt = (x: number) => (x >= 10 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ""));
  if (a >= 10_000_000) return `${s}${fmt(a / 10_000_000)}Cr`;
  if (a >= 100_000) return `${s}${fmt(a / 100_000)}L`;
  if (a >= 1_000) return `${s}${fmt(a / 1_000)}k`;
  return `${s}${a.toFixed(0)}`;
}

/** Up to 4 round tick values from 0 to at least `max`. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

/** "2026-10-27" → "27 Oct". */
export function shortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d} ${MONTHS[m! - 1]}`;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function TableView({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="text-sm print:hidden">
      <summary className="text-muted-foreground cursor-pointer text-xs">Show as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`border-b py-1 font-medium ${i ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((c, i) => (
                  <td key={i} className={`py-0.5 ${i ? "text-right tabular-nums" : ""}`}>
                    {typeof c === "number" ? formatMoney(c) : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Gridlines and y-axis labels shared by the column and line charts. */
function YAxis({ max, height }: { max: number; height: number }) {
  const t = ticks(max);
  const top = t[t.length - 1]!;
  const y = (v: number) => PAD.top + (height - PAD.top - PAD.bottom) * (1 - v / (top || 1));
  return (
    <g>
      {t.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 6}
            y={y(v)}
            dy="0.32em"
            textAnchor="end"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {shortRupees(v)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Top of the y scale for these values (the last round tick). */
const scaleTop = (max: number) => {
  const t = ticks(max);
  return t[t.length - 1]! || 1;
};

/** A path for a bar with 4px rounded top corners, flat on its base. */
function barPath(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return "";
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Columns per day, stacked by series (e.g. deliveries and counter sales). */
export function StackedColumns({
  title,
  data,
  series,
  height = 200,
}: {
  title: string;
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
}) {
  const totals = data.map((d) => d.values.reduce((s, v) => s + v, 0));
  const top = scaleTop(Math.max(...totals, 0));
  const plotH = height - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / data.length;
  const barW = Math.max(slot - 2, 1);
  const every = Math.ceil(data.length / 5);
  return (
    <figure className="space-y-2">
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={title}>
        <YAxis max={Math.max(...totals, 0)} height={height} />
        {data.map((d, i) => {
          const x = PAD.left + i * slot + 1;
          let base = PAD.top + plotH;
          const last = d.values.reduce((k, v, j) => (v > 0 ? j : k), -1);
          return (
            <g key={d.label} className="group">
              <title>
                {`${d.label}: ${formatMoney(totals[i]!)}${series.length > 1 ? ` (${series.map((s, j) => `${s.name} ${formatMoney(d.values[j]!)}`).join(", ")})` : ""}`}
              </title>
              {/* Hit area: the whole column, taller than the bar. */}
              <rect x={x - 1} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {d.values.map((v, j) => {
                const h = (v / top) * plotH;
                if (h <= 0) return null;
                // 2px surface gap between stacked segments.
                const gap = j > 0 && base < PAD.top + plotH ? 2 : 0;
                base -= h;
                return (
                  <path
                    key={j}
                    d={barPath(x, base, barW, h - gap, j === last)}
                    fill={series[j]!.color}
                    className="transition-opacity group-hover:opacity-80"
                  />
                );
              })}
              {i % every === 0 || i === data.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <TableView
        caption={title}
        head={["Day", ...series.map((s) => s.name)]}
        rows={data.map((d) => [d.label, ...d.values])}
      />
    </figure>
  );
}

/** Lines over time (weeks), one per series, on one rupee axis. */
export function Lines({
  title,
  data,
  series,
  height = 200,
}: {
  title: string;
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
}) {
  const max = Math.max(...data.flatMap((d) => d.values), 0);
  const top = scaleTop(max);
  const plotH = height - PAD.top - PAD.bottom;
  const right = 44; // room for the end values
  const stepX = (W - PAD.left - right) / Math.max(data.length - 1, 1);
  const x = (i: number) => PAD.left + i * stepX;
  const y = (v: number) => PAD.top + plotH * (1 - Math.max(v, 0) / top);
  const every = Math.ceil(data.length / 6);
  return (
    <figure className="space-y-2">
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={title}>
        <YAxis max={max} height={height} />
        {series.map((s, j) => (
          <g key={s.name}>
            <polyline
              points={data.map((d, i) => `${x(i)},${y(d.values[j]!)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {/* Direct label at the line's end (value in text ink, not the series color). */}
            <text
              x={x(data.length - 1) + 8}
              y={y(data[data.length - 1]?.values[j] ?? 0)}
              dy="0.32em"
              className="fill-foreground text-[10px]"
            >
              {shortRupees(data[data.length - 1]?.values[j] ?? 0)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.label} className="group">
            <title>
              {`${d.label}: ${series.map((s, j) => `${s.name} ${formatMoney(d.values[j]!)}`).join(", ")}`}
            </title>
            <rect
              x={x(i) - stepX / 2}
              y={PAD.top}
              width={stepX}
              height={plotH}
              fill="transparent"
            />
            <line
              x1={x(i)}
              x2={x(i)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--chart-axis)"
              className="opacity-0 group-hover:opacity-100"
            />
            {series.map((s, j) => (
              <circle
                key={s.name}
                cx={x(i)}
                cy={y(d.values[j]!)}
                r={4}
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
                className="opacity-0 group-hover:opacity-100"
              />
            ))}
            {i % every === 0 || i === data.length - 1 ? (
              <text
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <TableView
        caption={title}
        head={["Week ending", ...series.map((s) => s.name)]}
        rows={data.map((d) => [d.label, ...d.values])}
      />
    </figure>
  );
}

/** Horizontal bars, largest first (one series: the title names it). */
export function Bars({
  title,
  data,
  color,
}: {
  title: string;
  data: { label: string; value: number }[];
  color: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  return (
    <figure className="space-y-2">
      <ul className="space-y-2" aria-label={title}>
        {data.map((d) => (
          <li key={d.label} className="space-y-1" title={`${d.label}: ${formatMoney(d.value)}`}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">{d.label}</span>
              <span className="text-muted-foreground tabular-nums">{formatMoney(d.value)}</span>
            </div>
            <div className="bg-muted h-2 rounded-r">
              <div
                className="h-2 rounded-r"
                style={{ width: `${Math.max((d.value / max) * 100, 0)}%`, background: color }}
              />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
