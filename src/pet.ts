export type Pt = { x: number; y: number };

export type Anchor =
    { kind: "floor" } | { kind: "element"; id: string; offset: number };

export type Phase = "idle" | "hop" | "shout" | "fall";

export type Frame = "idle" | "shout";

export type Hop = { from: Pt; to: Pt; peakY: number; land: Anchor };

export type Stop = { land: Anchor; x: number };

export type PetState = {
    phase: Phase;
    x: number;
    y: number;
    facing: 1 | -1;
    anchor: Anchor;
    phaseStart: number;
    until: number;
    frame: Frame;
    sx: number;
    sy: number;
    hop?: Hop;
    path: Stop[];
    shoutQueued: boolean;
};

export type Platform = { id: string; left: number; right: number; top: number };

export type World = {
    platforms: Platform[];
    floorY: number;
    viewW: number;
    viewH: number;
    zoom: number;
};

export const PET_W = 96;
export const PET_H = 85;
export const IDLE_MIN_MS = 1500;
export const IDLE_MAX_MS = 4000;
export const HOP_CHANCE = 0.7;
export const PLATFORM_REACH_PX = 360;
export const FLOOR_REACH_PX = 300;
export const MIN_TOP_PX = 40;
export const HOP_MAX_DX = 160;
export const HOP_MS = 420;
export const TAKEOFF_MS = 80;
export const LANDING_MS = 100;
export const PEAK_PX = 60;
export const SHOUT_MS = 1200;
export const SHOUT_FRAME_MS = 120;
export const POP_MS = 150;
export const POP_SCALE = 1.15;
export const GRAVITY = 2400;
export const FALL_FROM_Y = -100;
export const NARROW_PX = 200;
export const SQUASH = { sx: 1.1, sy: 0.85 };
export const AIRBORNE_SY = 1.08;

const HALF_W = PET_W / 2;
const FLOOR: Anchor = { kind: "floor" };

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, v));

const floorX = (x: number, w: World): number =>
    w.viewW < PET_W ? w.viewW / 2 : clamp(x, HALF_W, w.viewW - HALF_W);

const platformOf = (w: World, id: string): Platform | undefined =>
    w.platforms.find((p) => p.id === id);

const place = (anchor: Anchor, x: number, w: World): Pt | null => {
    if (anchor.kind === "floor") return { x: floorX(x, w), y: w.floorY };
    const p = platformOf(w, anchor.id);
    if (!p) return null;
    return {
        x: clamp(p.left + anchor.offset * w.zoom, p.left, p.right),
        y: p.top,
    };
};

const onPlatform = (p: Platform, x: number, w: World): Anchor => ({
    kind: "element",
    id: p.id,
    offset: (x - p.left) / w.zoom,
});

const landingSpan = (p: Platform, w: World): { lo: number; hi: number } => ({
    lo: Math.max(p.left, HALF_W),
    hi: Math.min(p.right, w.viewW - HALF_W),
});

const standable = (p: Platform, w: World): boolean => {
    const { lo, hi } = landingSpan(p, w);
    return lo <= hi && p.top >= MIN_TOP_PX && p.top <= w.floorY;
};

const idleFor = (rand: () => number): number =>
    IDLE_MIN_MS + rand() * (IDLE_MAX_MS - IDLE_MIN_MS);

const settle = (
    s: PetState,
    now: number,
    rand: () => number,
    at: Pt,
    anchor: Anchor
): PetState => ({
    ...s,
    phase: "idle",
    x: at.x,
    y: at.y,
    anchor,
    phaseStart: now,
    until: now + idleFor(rand),
    frame: "idle",
    sx: 1,
    sy: 1,
    hop: undefined,
    path: [],
    shoutQueued: false,
});

const shout = (s: PetState, now: number): PetState => ({
    ...s,
    phase: "shout",
    phaseStart: now,
    until: now + SHOUT_MS,
    frame: "shout",
    sx: POP_SCALE,
    sy: POP_SCALE,
    hop: undefined,
    path: [],
    shoutQueued: false,
});

const fall = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => ({
    ...s,
    phase: "fall",
    x: floorX(HALF_W + rand() * (w.viewW - PET_W), w),
    y: FALL_FROM_Y,
    anchor: FLOOR,
    phaseStart: now,
    until: Infinity,
    frame: "idle",
    sx: 1,
    sy: AIRBORNE_SY,
    hop: undefined,
    path: [],
});

const pickGoal = (s: PetState, w: World, rand: () => number): Stop => {
    if (rand() < HOP_CHANCE) {
        const current = s.anchor.kind === "element" ? s.anchor.id : null;
        let best: { p: Platform; d: number } | null = null;
        for (const p of w.platforms) {
            if (p.id === current || !standable(p, w)) continue;
            const { lo, hi } = landingSpan(p, w);
            const d = Math.max(lo - s.x, 0, s.x - hi);
            if (d <= PLATFORM_REACH_PX && (best === null || d < best.d)) {
                best = { p, d };
            }
        }
        if (best !== null) {
            const { lo, hi } = landingSpan(best.p, w);
            const x = lo + (0.2 + 0.6 * rand()) * (hi - lo);
            return { land: onPlatform(best.p, x, w), x };
        }
    }
    return {
        land: FLOOR,
        x: floorX(s.x + (rand() * 2 - 1) * FLOOR_REACH_PX, w),
    };
};

// Stops between start and goal land on the platform the pet leaves or the
// one it heads for while the x is over it, and on the floor otherwise.
const planPath = (s: PetState, goal: Stop, w: World): Stop[] => {
    const to = place(goal.land, goal.x, w);
    if (!to) return [];
    const dx = to.x - s.x;
    const hops = Math.max(1, Math.ceil(Math.abs(dx) / HOP_MAX_DX));
    const ends = [s.anchor, goal.land].flatMap((a) => {
        const p = a.kind === "element" ? platformOf(w, a.id) : undefined;
        return p ? [p] : [];
    });
    const stops: Stop[] = [];
    for (let i = 1; i < hops; i++) {
        const x = s.x + (dx * i) / hops;
        const over = ends.find((p) => x >= p.left && x <= p.right);
        stops.push({ land: over ? onPlatform(over, x, w) : FLOOR, x });
    }
    stops.push(goal);
    return stops;
};

const takeOff = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => {
    const [next, ...rest] = s.path;
    const to = next ? place(next.land, next.x, w) : null;
    if (!to) return settle(s, now, rand, { x: s.x, y: s.y }, s.anchor);
    const from = { x: s.x, y: s.y };
    const dx = to.x - from.x;
    return {
        ...s,
        phase: "hop",
        phaseStart: now,
        until: now + TAKEOFF_MS + HOP_MS + LANDING_MS,
        facing: dx > 0 ? 1 : dx < 0 ? -1 : s.facing,
        frame: "idle",
        sx: SQUASH.sx,
        sy: SQUASH.sy,
        hop: {
            from,
            to,
            peakY: Math.min(from.y, to.y) - PEAK_PX,
            land: next.land,
        },
        path: rest,
    };
};

// A parabola through both ends whose highest point is peakY.
const arc = (from: Pt, to: Pt, peakY: number, u: number): Pt => {
    const rise = Math.sqrt(from.y - peakY);
    const apex = rise / (rise + Math.sqrt(to.y - peakY));
    const k = (u - apex) / apex;
    return {
        x: from.x + (to.x - from.x) * u,
        y: peakY + (from.y - peakY) * k * k,
    };
};

const stepHop = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => {
    const hop = s.hop!;
    const t = now - s.phaseStart;
    const landing = place(hop.land, hop.to.x, w);
    const to = landing ?? hop.to;
    const live: Hop = {
        ...hop,
        to,
        peakY: Math.min(hop.from.y, to.y) - PEAK_PX,
    };
    if (t < TAKEOFF_MS) {
        return { ...s, hop: live, x: hop.from.x, y: hop.from.y };
    }
    if (t < TAKEOFF_MS + HOP_MS) {
        const p = arc(hop.from, to, live.peakY, (t - TAKEOFF_MS) / HOP_MS);
        return { ...s, hop: live, x: p.x, y: p.y, sx: 1, sy: AIRBORNE_SY };
    }
    if (!landing) return fall(s, now, w, rand);
    const landed = { ...s, hop: live, x: to.x, y: to.y, anchor: hop.land };
    if (s.shoutQueued) return shout(landed, now);
    if (now < s.until) return { ...landed, sx: SQUASH.sx, sy: SQUASH.sy };
    if (s.path.length > 0) return takeOff(landed, now, w, rand);
    return settle(landed, now, rand, to, hop.land);
};

const stepFall = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => {
    if (Number.isFinite(s.until)) {
        const at = place(s.anchor, s.x, w);
        if (!at) return fall(s, now, w, rand);
        if (now >= s.until) return settle(s, now, rand, at, s.anchor);
        return { ...s, x: at.x, y: at.y };
    }
    const t = (now - s.phaseStart) / 1000;
    const y = FALL_FROM_Y + 0.5 * GRAVITY * t * t;
    const hit = w.platforms
        .filter(
            (p) =>
                standable(p, w) &&
                s.x >= p.left &&
                s.x <= p.right &&
                p.top >= s.y &&
                p.top <= y
        )
        .sort((a, b) => a.top - b.top)[0];
    if (!hit && y < w.floorY) return { ...s, y, sx: 1, sy: AIRBORNE_SY };
    const landed: PetState = hit
        ? { ...s, y: hit.top, anchor: onPlatform(hit, s.x, w) }
        : { ...s, y: w.floorY, anchor: FLOOR };
    if (s.shoutQueued) return shout(landed, now);
    return {
        ...landed,
        until: now + LANDING_MS,
        sx: SQUASH.sx,
        sy: SQUASH.sy,
    };
};

const stepGrounded = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => {
    const at = place(s.anchor, s.x, w);
    if (!at) return fall(s, now, w, rand);
    const here = { ...s, x: at.x, y: at.y };
    if (s.phase === "shout") {
        if (now >= s.until) return settle(here, now, rand, at, s.anchor);
        const t = now - s.phaseStart;
        const pop = t < POP_MS ? POP_SCALE : 1;
        return {
            ...here,
            frame: Math.floor(t / SHOUT_FRAME_MS) % 2 === 0 ? "shout" : "idle",
            sx: pop,
            sy: pop,
        };
    }
    if (now < s.until) return here;
    if (w.viewW < NARROW_PX) return settle(here, now, rand, at, s.anchor);
    const path = planPath(here, pickGoal(here, w, rand), w);
    return takeOff({ ...here, path }, now, w, rand);
};

export function stepPet(
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState {
    const world = w.viewW < NARROW_PX ? { ...w, platforms: [] } : w;
    switch (s.phase) {
        case "hop":
            return stepHop(s, now, world, rand);
        case "fall":
            return stepFall(s, now, world, rand);
        default:
            return stepGrounded(s, now, world, rand);
    }
}

export function clickPet(s: PetState, now: number): PetState {
    const airborne =
        s.phase === "hop" || (s.phase === "fall" && !Number.isFinite(s.until));
    return airborne ? { ...s, shoutQueued: true } : shout(s, now);
}

export function spawnPet(now: number, w: World, rand: () => number): PetState {
    const start: PetState = {
        phase: "fall",
        x: 0,
        y: FALL_FROM_Y,
        facing: 1,
        anchor: FLOOR,
        phaseStart: now,
        until: Infinity,
        frame: "idle",
        sx: 1,
        sy: AIRBORNE_SY,
        path: [],
        shoutQueued: false,
    };
    return fall(start, now, w, rand);
}

/** Drops a standing pet back in from the top when its spot has left the view. */
export function recallPet(
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState {
    if (s.phase !== "idle" && s.phase !== "shout") return s;
    const outside =
        s.x + HALF_W < 0 ||
        s.x - HALF_W > w.viewW ||
        s.y < 0 ||
        s.y - PET_H > w.viewH;
    return outside ? fall(s, now, w, rand) : s;
}
