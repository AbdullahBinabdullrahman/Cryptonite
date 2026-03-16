/**
 * BotSprite — 8-bit pixel-art trading bot character
 * Pure CSS box-shadow pixel art, zero external assets.
 * States: idle | running | win | loss | danger
 *
 * Usage:
 *   <BotSprite state="running" size={32} />
 */

import { useEffect, useRef, useState } from "react";

export type SpriteState = "idle" | "running" | "win" | "loss" | "danger";

interface BotSpriteProps {
  state?: SpriteState;
  size?: number;       // pixel size of one "pixel unit" (default 4)
  label?: boolean;     // show animated status label below
  className?: string;
}

// ─── Pixel palette ────────────────────────────────────────────────────────────
const C = {
  green:   "#00ff55",
  green2:  "#00cc44",
  green3:  "#009933",
  amber:   "#ffb700",
  amber2:  "#cc8800",
  cyan:    "#00e5cc",
  cyan2:   "#00b8a0",
  red:     "#ff2244",
  red2:    "#cc0022",
  dark:    "#0a0f0a",
  dark2:   "#141a14",
  gray:    "#334433",
  gray2:   "#223322",
  white:   "#ccffcc",
  gold:    "#ffd700",
  gold2:   "#ccaa00",
  trans:   "transparent",
};

// ─── Sprite frame definitions (14×16 pixel grid) ─────────────────────────────
// Each frame is an array of [x, y, color] tuples — 1-indexed
// We render via a single <div> whose box-shadow draws each pixel

type Pixel = [number, number, string];

// HEAD (shared across frames) — robot helmet
const HEAD: Pixel[] = [
  // top dome
  [5,1,C.gray],[6,1,C.green3],[7,1,C.green3],[8,1,C.green3],[9,1,C.gray],
  [4,2,C.green3],[5,2,C.green2],[6,2,C.green],[7,2,C.green],[8,2,C.green2],[9,2,C.green3],[10,2,C.green3],
  [4,3,C.green3],[5,3,C.dark],[6,3,C.cyan],[7,3,C.dark],[8,3,C.cyan],[9,3,C.dark],[10,3,C.green3],
  [4,4,C.green2],[5,4,C.green],[6,4,C.green],[7,4,C.green],[8,4,C.green],[9,4,C.green],[10,4,C.green2],
  // antenna
  [7,0,C.amber],[7,-1,C.amber2],
  // ear sensors
  [3,3,C.amber],[11,3,C.amber],
  [3,4,C.amber2],[11,4,C.amber2],
];

// BODY (shared)
const BODY: Pixel[] = [
  [5,5,C.gray2],[6,5,C.green3],[7,5,C.green3],[8,5,C.green3],[9,5,C.gray2],
  [4,6,C.green3],[5,6,C.dark2],[6,6,C.cyan],[7,6,C.dark2],[8,6,C.cyan],[9,6,C.dark2],[10,6,C.green3],
  [4,7,C.green3],[5,7,C.green2],[6,7,C.green2],[7,7,C.amber],[8,7,C.green2],[9,7,C.green2],[10,7,C.green3],
  [4,8,C.green3],[5,8,C.dark2],[6,8,C.green],[7,8,C.green],[8,8,C.green],[9,8,C.dark2],[10,8,C.green3],
  [5,9,C.gray2],[6,9,C.green3],[7,9,C.green3],[8,9,C.green3],[9,9,C.gray2],
];

// IDLE frame A — arms down, legs together
const IDLE_A: Pixel[] = [
  ...HEAD,
  ...BODY,
  // arms (down)
  [3,6,C.green3],[3,7,C.green2],[3,8,C.green3],
  [11,6,C.green3],[11,7,C.green2],[11,8,C.green3],
  // hands
  [2,8,C.cyan],[12,8,C.cyan],
  // legs
  [5,10,C.green3],[6,10,C.green3],[8,10,C.green3],[9,10,C.green3],
  [5,11,C.green2],[6,11,C.green2],[8,11,C.green2],[9,11,C.green2],
  [5,12,C.green3],[6,12,C.dark],[8,12,C.green3],[9,12,C.dark],
  // feet
  [4,13,C.green3],[5,13,C.green3],[6,13,C.gray],[8,13,C.green3],[9,13,C.green3],[10,13,C.gray],
];

// IDLE frame B — slight bob (body up 1, legs extended)
const IDLE_B: Pixel[] = IDLE_A.map(([x, y, c]) => [x, y - (y >= 5 && y <= 13 ? 1 : 0), c] as Pixel);

// WALK frame A — left arm forward, right arm back, left leg forward
const WALK_A: Pixel[] = [
  ...HEAD,
  ...BODY,
  // arms — left forward (up), right back (down)
  [3,5,C.green2],[3,6,C.green3],[3,7,C.cyan],   // left arm forward
  [11,7,C.green3],[11,8,C.green2],[11,9,C.cyan], // right arm back
  // legs — left fwd, right back
  [5,10,C.green3],[6,10,C.green3],
  [5,11,C.green2],[4,12,C.green3],[4,13,C.green3],[5,13,C.gray], // left leg forward
  [8,10,C.green3],[9,10,C.green3],
  [9,11,C.green2],[10,12,C.green3],[9,13,C.green3], // right leg back
];

// WALK frame B — opposite
const WALK_B: Pixel[] = [
  ...HEAD,
  ...BODY,
  // arms — right forward (up), left back (down)
  [11,5,C.green2],[11,6,C.green3],[11,7,C.cyan],  // right arm forward
  [3,7,C.green3],[3,8,C.green2],[3,9,C.cyan],      // left arm back
  // legs — right fwd, left back
  [8,10,C.green3],[9,10,C.green3],
  [9,11,C.green2],[10,12,C.green3],[10,13,C.green3],[9,13,C.gray],
  [5,10,C.green3],[6,10,C.green3],
  [5,11,C.green2],[4,12,C.green3],[5,13,C.green3],
];

// WIN — arms up, stars around
const WIN_A: Pixel[] = [
  ...HEAD.map(([x, y, c]) => [x, y, c === C.green || c === C.green2 ? C.gold : c === C.cyan ? C.gold2 : c] as Pixel),
  ...BODY.map(([x, y, c]) => [x, y, c === C.green || c === C.green2 ? C.gold2 : c] as Pixel),
  // both arms up high
  [3,4,C.gold],[3,5,C.gold2],[2,4,C.gold],
  [11,4,C.gold],[11,5,C.gold2],[12,4,C.gold],
  // legs — jump pose
  [5,10,C.green3],[6,10,C.green3],[8,10,C.green3],[9,10,C.green3],
  [4,11,C.green2],[6,11,C.green2],[8,11,C.green2],[10,11,C.green2],
  // stars
  [2,2,C.gold],[14,2,C.gold],[1,5,C.gold2],[13,6,C.gold2],
  [2,8,C.gold],[14,7,C.gold],
];

const WIN_B: Pixel[] = WIN_A.map(([x, y, c]) => {
  // stars twinkle
  if ((x === 2 && y === 2) || (x === 14 && y === 2)) return [x, y, C.white] as Pixel;
  if ((x === 1 && y === 5) || (x === 13 && y === 6)) return [x, y, C.gold] as Pixel;
  return [x, y, c] as Pixel;
});

// LOSS — slumped, sad eyes, X for pupils
const LOSS_A: Pixel[] = [
  // head — slumped (shifted down 1)
  [7,1,C.gray2],
  [4,2,C.gray],[5,2,C.green3],[6,2,C.green3],[7,2,C.green3],[8,2,C.green3],[9,2,C.green3],[10,2,C.gray],
  [4,3,C.green3],[5,3,C.dark],[6,3,C.red2],[7,3,C.dark],[8,3,C.red2],[9,3,C.dark],[10,3,C.green3],
  [4,4,C.green3],[5,4,C.green3],[6,4,C.green3],[7,4,C.green3],[8,4,C.green3],[9,4,C.green3],[10,4,C.green3],
  // droopy antenna
  [7,0,C.gray],[8,-1,C.gray2],
  // sad mouth line (down)
  [6,4,C.dark],[7,4,C.dark],[8,4,C.dark],
  // ears dim
  [3,3,C.gray2],[11,3,C.gray2],
  // body — dim
  ...BODY.map(([x,y,c]) => [x, y, c === C.green || c === C.green2 ? C.gray : c === C.cyan ? C.gray2 : c] as Pixel),
  // arms down low
  [3,8,C.gray],[3,9,C.gray2],
  [11,8,C.gray],[11,9,C.gray2],
  // legs — crouched
  [5,10,C.green3],[6,10,C.green3],[8,10,C.green3],[9,10,C.green3],
  [5,11,C.green3],[6,11,C.green3],[8,11,C.green3],[9,11,C.green3],
  [5,12,C.dark],[6,12,C.dark],[8,12,C.dark],[9,12,C.dark],
  // tears
  [4,5,C.cyan],[10,5,C.cyan],
];

const LOSS_B: Pixel[] = LOSS_A.map(([x,y,c]) => {
  if ((x===4&&y===5)||(x===10&&y===5)) return [x, y+1, C.cyan] as Pixel;
  return [x, y, c] as Pixel;
});

// DANGER — red alert, flashing
const DANGER_A: Pixel[] = [
  ...HEAD.map(([x,y,c]) => [x, y, c === C.green || c === C.green2 ? C.red : c === C.cyan ? C.red2 : c] as Pixel),
  ...BODY.map(([x,y,c]) => [x, y, c === C.green || c === C.green2 ? C.red2 : c] as Pixel),
  // alert triangles
  [7,0,C.red],[6,-1,C.red],[8,-1,C.red],
  // arms raised slightly
  [3,5,C.red2],[3,6,C.red],
  [11,5,C.red2],[11,6,C.red],
  // legs
  [5,10,C.red2],[6,10,C.red2],[8,10,C.red2],[9,10,C.red2],
  [5,11,C.red],[6,11,C.red],[8,11,C.red],[9,11,C.red],
  [5,12,C.dark],[6,12,C.dark],[8,12,C.dark],[9,12,C.dark],
  [4,13,C.red2],[5,13,C.red2],[6,13,C.dark],[8,13,C.red2],[9,13,C.red2],[10,13,C.dark],
];

const DANGER_B: Pixel[] = DANGER_A.map(([x,y,c]) => [x, y, c === C.red ? C.amber : c === C.red2 ? C.amber2 : c] as Pixel);

// ─── Frame maps ───────────────────────────────────────────────────────────────
const FRAMES: Record<SpriteState, Pixel[][]> = {
  idle:    [IDLE_A, IDLE_B],
  running: [WALK_A, WALK_B],
  win:     [WIN_A, WIN_B],
  loss:    [LOSS_A, LOSS_B],
  danger:  [DANGER_A, DANGER_B],
};

const FRAME_MS: Record<SpriteState, number> = {
  idle:    800,
  running: 200,
  win:     300,
  loss:    600,
  danger:  200,
};

const STATE_LABELS: Record<SpriteState, string> = {
  idle:    "STANDBY",
  running: "TRADING",
  win:     "PROFIT!",
  loss:    "LOSS...",
  danger:  "DANGER!",
};

const STATE_COLORS: Record<SpriteState, string> = {
  idle:    C.green,
  running: C.cyan,
  win:     C.gold,
  loss:    C.red,
  danger:  C.red,
};

// ─── Render pixel frame to box-shadow string ──────────────────────────────────
function pixelsToBoxShadow(pixels: Pixel[], px: number): string {
  return pixels
    .map(([x, y, color]) => `${x * px}px ${y * px}px 0 ${px}px ${color}`)
    .join(",");
}

// ─── Component ────────────────────────────────────────────────────────────────
export function BotSprite({ state = "idle", size = 4, label = true, className }: BotSpriteProps) {
  const [frame, setFrame] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setFrame(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES[state].length);
    }, FRAME_MS[state]);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  const pixels = FRAMES[state][frame];
  const shadow = pixelsToBoxShadow(pixels, size);
  const color = STATE_COLORS[state];

  // canvas is 16 cols × 16 rows of "pixels"
  const canvasW = 16 * size;
  const canvasH = 16 * size;

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size,
        userSelect: "none",
      }}
    >
      {/* Sprite canvas */}
      <div
        style={{
          width: canvasW,
          height: canvasH,
          position: "relative",
          imageRendering: "pixelated",
        }}
      >
        {/* The actual sprite rendered as a 1×1 div with massive box-shadow */}
        <div
          style={{
            position: "absolute",
            width: size,
            height: size,
            top: 0,
            left: 0,
            boxShadow: shadow,
            imageRendering: "pixelated",
          }}
        />
        {/* Subtle glow behind sprite */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 50% 60%, ${color}15 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Status label */}
      {label && (
        <div style={{
          fontFamily: "var(--font-pixel)",
          fontSize: Math.max(size - 1, 5),
          color,
          letterSpacing: "0.1em",
          textShadow: `0 0 6px ${color}`,
          animation: state === "danger" || state === "win" ? "blink 0.5s step-end infinite" : "none",
        }}>
          {STATE_LABELS[state]}
        </div>
      )}
    </div>
  );
}

// ─── Bot sprite with live data wiring ─────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";

export function LiveBotSprite({ size = 4, label = true, className }: Omit<BotSpriteProps, "state">) {
  const { data } = useQuery({ queryKey: ["/api/dashboard"], refetchInterval: 5000 });
  const d: any = data || {};

  let spriteState: SpriteState = "idle";

  if (d.isRunning) {
    const pnl = d.todayPnl ?? 0;
    const stopLossPct = 15; // matches default
    const balance = d.totalBalance ?? 100000;
    const dailyLossLimit = balance * (stopLossPct / 100);

    if (pnl > 50) spriteState = "win";
    else if (pnl < -dailyLossLimit * 0.7) spriteState = "danger";
    else if (pnl < -20) spriteState = "loss";
    else spriteState = "running";
  }

  return <BotSprite state={spriteState} size={size} label={label} className={className} />;
}
