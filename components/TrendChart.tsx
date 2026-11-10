import type { TrendPoint } from "@/lib/queries";

/** 14-day headcount bars with the unwell count overlaid in red. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 560, H = 160, pad = 22;
  const max = Math.max(1, ...points.map((p) => p.total));
  const bw = (W - pad) / points.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Headcount over the last 14 days">
        {points.map((p, i) => {
          const h = (p.total / max) * (H - 16);
          const uh = (p.unwell / max) * (H - 16);
          const x = pad + i * bw + 3;
          const day = p.work_date.slice(8);
          return (
            <g key={p.work_date}>
              <title>{`${p.work_date}: ${p.total} workers, ${p.unwell} unwell`}</title>
              <rect x={x} y={H - h} width={bw - 6} height={h} rx={3} fill="var(--bar)" opacity={0.85} />
              {p.unwell > 0 && (
                <rect x={x} y={H - Math.max(uh, 2)} width={bw - 6} height={Math.max(uh, 2)} fill="var(--bad)" />
              )}
              <text x={x + (bw - 6) / 2} y={H + 13} textAnchor="middle" className="axis">{day}</text>
            </g>
          );
        })}
        <text x={0} y={10} className="axis">{max}</text>
        <line x1={pad} x2={W} y1={H} y2={H} stroke="var(--line)" />
      </svg>
      <div className="small muted">
        <span style={{ color: "var(--bar)" }}>■</span> workers checked in &nbsp;
        <span style={{ color: "var(--bad)" }}>■</span> unwell
      </div>
    </div>
  );
}
