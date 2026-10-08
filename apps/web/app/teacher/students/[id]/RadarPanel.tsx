"use client";

import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, ResponsiveContainer,
} from "recharts";

export interface RadarDatum {
  dim: string;
  本人: number;
  班级: number;
}

export default function RadarPanel({ data }: { data: RadarDatum[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: "#475569" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} />
          <Radar name="班级均值" dataKey="班级" stroke="#94A3B8" fill="#94A3B8" fillOpacity={0.12} strokeDasharray="4 3" />
          <Radar name="本人" dataKey="本人" stroke="#6C5CE7" fill="#6C5CE7" fillOpacity={0.22} />
          <Tooltip formatter={(v: number) => [String(Math.round(v)), "分"]} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
