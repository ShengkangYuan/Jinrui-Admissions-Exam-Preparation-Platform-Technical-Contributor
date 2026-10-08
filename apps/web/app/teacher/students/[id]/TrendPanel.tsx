"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export interface TrendSeries {
  key: string;
  color: string;
  dash?: boolean;
}

export default function TrendPanel({
  data,
  series,
  interval = "preserveStartEnd",
}: {
  data: Record<string, any>[];
  series: TrendSeries[];
  interval?: number | "preserveStart" | "preserveEnd" | "preserveStartEnd" | "equidistantPreserveStart";
}) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: "#64748b" }} interval={interval} angle={-15} textAnchor="end" height={40} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} unit="%" />
          <Tooltip formatter={(v: number) => [`${v}%`, "得分率"]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
          <ReferenceLine y={90} stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" label={{ value: "90%", position: "right", fontSize: 9, fill: "#ea580c" }} />
          <ReferenceLine y={80} stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" label={{ value: "80%", position: "right", fontSize: 9, fill: "#7c3aed" }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={s.dash ? 1.6 : 2.2}
              strokeDasharray={s.dash ? "5 4" : undefined}
              dot={s.dash ? false : { r: 3, fill: "#fff", stroke: s.color, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
