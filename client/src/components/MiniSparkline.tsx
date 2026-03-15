/**
 * MiniSparkline — tiny inline SVG sparkline for price history
 */
import React from "react";
import { PricePoint } from "@/hooks/useLiveData";

interface Props {
  data: PricePoint[];
  width?: number;
  height?: number;
  color?: string;   // e.g. "hsl(142 72% 45%)"
  strokeWidth?: number;
}

export function MiniSparkline({ data, width = 80, height = 32, color = "hsl(175 75% 42%)", strokeWidth = 1.5 }: Props) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} />;
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * w;
    const y = pad + h - ((p - min) / range) * h;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Fill area
  const first = points[0];
  const last = points[points.length - 1];
  const fillPath = `M${first} L${polyline.split(" ").slice(1).join(" L")} L${last.split(",")[0]},${pad + h} L${pad},${pad + h} Z`;

  const isUp = prices[prices.length - 1] >= prices[0];
  const fillColor = isUp ? "hsl(142 72% 45% / 0.12)" : "hsl(0 65% 50% / 0.10)";
  const lineColor = isUp ? "hsl(142 72% 45%)" : "hsl(0 65% 50%)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={fillPath} fill={fillColor} />
      <polyline
        points={polyline}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last price dot */}
      {(() => {
        const lastPt = points[points.length - 1].split(",");
        return <circle cx={lastPt[0]} cy={lastPt[1]} r={2} fill={lineColor} />;
      })()}
    </svg>
  );
}
