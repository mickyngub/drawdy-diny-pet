export type Pt = { x: number; y: number };

export type Anchor =
    { kind: "floor" } | { kind: "element"; id: string; offset: number };

export type Phase = "idle" | "hop" | "shout" | "fall" | "sleep" | "held";

export type Frame =
    | "idle"
    | "happy"
    | "wave"
    | "jump"
    | "fall"
    | "shout"
    | "tired"
    | "sleep"
    | "held";

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
    fallFrom: number;
    hops: number;
    // From the pointer to the feet, kept while Diny is held.
    grab?: Pt;
    // Set while Diny drops into view, so its first stop is a hello.
    greet?: boolean;
};

export type Platform = {
    id: string;
    left: number;
    right: number;
    top: number;
    // Heights of a curved top, evenly spaced from left to right; a flat top has none.
    ys?: number[];
};

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
export const FOOT_PX = 16;
export const MAX_SLOPE = 0.5;
export const SPOT_PX = 8;
export const TIRED_HOPS = 20;
export const SLEEP_MIN_MS = 20000;
export const SLEEP_MAX_MS = 40000;

const HALF_W = PET_W / 2;
const FLOOR: Anchor = { kind: "floor" };

type Span = { lo: number; hi: number };

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, v));

const floorX = (x: number, w: World): number =>
    w.viewW < PET_W ? w.viewW / 2 : clamp(x, HALF_W, w.viewW - HALF_W);

const platformOf = (w: World, id: string): Platform | undefined =>
    w.platforms.find((p) => p.id === id);

const heightAt = (p: Platform, x: number): number => {
    const { ys } = p;
    if (!ys || ys.length < 2) return p.top;
    const u =
        ((clamp(x, p.left, p.right) - p.left) / (p.right - p.left)) *
        (ys.length - 1);
    const i = Math.min(Math.floor(u), ys.length - 2);
    return ys[i] + (ys[i + 1] - ys[i]) * (u - i);
};

// The feet rest on the highest point under them, so a slope never swallows a foot.
const restY = (p: Platform, x: number): number => {
    const { ys } = p;
    if (!ys || ys.length < 2) return p.top;
    const lo = Math.max(p.left, x - FOOT_PX);
    const hi = Math.min(p.right, x + FOOT_PX);
    const step = (p.right - p.left) / (ys.length - 1);
    let y = Math.min(heightAt(p, lo), heightAt(p, hi));
    for (
        let i = Math.ceil((lo - p.left) / step);
        i < ys.length && p.left + i * step <= hi;
        i++
    ) {
        y = Math.min(y, ys[i]);
    }
    return y;
};

const slopeAt = (p: Platform, x: number): number =>
    (heightAt(p, x + FOOT_PX) - heightAt(p, x - FOOT_PX)) / (2 * FOOT_PX);

const standableAt = (p: Platform, x: number, w: World): boolean => {
    const y = restY(p, x);
    return (
        y >= MIN_TOP_PX && y <= w.floorY && Math.abs(slopeAt(p, x)) <= MAX_SLOPE
    );
};

const place = (anchor: Anchor, x: number, w: World): Pt | null => {
    if (anchor.kind === "floor") return { x: floorX(x, w), y: w.floorY };
    const p = platformOf(w, anchor.id);
    if (!p) return null;
    const at = clamp(p.left + anchor.offset * w.zoom, p.left, p.right);
    return { x: at, y: restY(p, at) };
};

const onPlatform = (p: Platform, x: number, w: World): Anchor => ({
    kind: "element",
    id: p.id,
    offset: (x - p.left) / w.zoom,
});

// The stretches of a platform's top, in view, gentle enough to land on.
const landingSpans = (p: Platform, w: World): Span[] => {
    const lo = Math.max(p.left, HALF_W);
    const hi = Math.min(p.right, w.viewW - HALF_W);
    if (lo > hi) return [];
    if (!p.ys) return standableAt(p, lo, w) ? [{ lo, hi }] : [];
    const n = Math.max(1, Math.ceil((hi - lo) / SPOT_PX));
    const half = (hi - lo) / n / 2;
    const spans: Span[] = [];
    for (let k = 0; k <= n; k++) {
        const x = lo + ((hi - lo) * k) / n;
        if (!standableAt(p, x, w)) continue;
        const last = spans.at(-1);
        if (last && last.hi >= x - half) last.hi = Math.min(hi, x + half);
        else
            spans.push({
                lo: Math.max(lo, x - half),
                hi: Math.min(hi, x + half),
            });
    }
    return spans;
};

const distanceTo = (spans: Span[], x: number): number =>
    Math.min(...spans.map((s) => Math.max(s.lo - x, 0, x - s.hi)));

// Lands in the middle 60% of the standable length, skipping the steep parts.
const spotIn = (spans: Span[], r: number): number => {
    const total = spans.reduce((sum, s) => sum + s.hi - s.lo, 0);
    let rest = (0.2 + 0.6 * r) * total;
    for (const s of spans) {
        if (rest <= s.hi - s.lo) return s.lo + rest;
        rest -= s.hi - s.lo;
    }
    return spans[spans.length - 1].hi;
};

const idleFor = (rand: () => number): number =>
    IDLE_MIN_MS + rand() * (IDLE_MAX_MS - IDLE_MIN_MS);

const restingFrame = (s: PetState, anchor: Anchor): Frame => {
    if (s.hops >= TIRED_HOPS) return "tired";
    if (s.greet) return "wave";
    return anchor.kind === "element" ? "happy" : "idle";
};

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
    frame: restingFrame(s, anchor),
    sx: 1,
    sy: 1,
    hop: undefined,
    path: [],
    shoutQueued: false,
    greet: false,
});

const nap = (s: PetState, now: number, rand: () => number): PetState => ({
    ...s,
    phase: "sleep",
    phaseStart: now,
    until: now + SLEEP_MIN_MS + rand() * (SLEEP_MAX_MS - SLEEP_MIN_MS),
    frame: "sleep",
    sx: 1,
    sy: 1,
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

const dropFrom = (s: PetState, now: number, at: Pt): PetState => ({
    ...s,
    phase: "fall",
    x: at.x,
    y: at.y,
    fallFrom: at.y,
    anchor: FLOOR,
    phaseStart: now,
    until: Infinity,
    frame: "fall",
    sx: 1,
    sy: AIRBORNE_SY,
    hop: undefined,
    path: [],
});

const fall = (
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState => ({
    ...dropFrom(s, now, {
        x: floorX(HALF_W + rand() * (w.viewW - PET_W), w),
        y: FALL_FROM_Y,
    }),
    greet: true,
});

const pickGoal = (s: PetState, w: World, rand: () => number): Stop => {
    if (rand() < HOP_CHANCE) {
        const current = s.anchor.kind === "element" ? s.anchor.id : null;
        let best: { p: Platform; spans: Span[]; d: number } | null = null;
        for (const p of w.platforms) {
            if (p.id === current) continue;
            const spans = landingSpans(p, w);
            if (spans.length === 0) continue;
            const d = distanceTo(spans, s.x);
            if (d <= PLATFORM_REACH_PX && (best === null || d < best.d)) {
                best = { p, spans, d };
            }
        }
        if (best !== null) {
            const x = spotIn(best.spans, rand());
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
        hops: s.hops + 1,
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
        return {
            ...s,
            hop: live,
            x: p.x,
            y: p.y,
            frame: "jump",
            sx: 1,
            sy: AIRBORNE_SY,
        };
    }
    if (!landing) return dropFrom(s, now, to);
    const landed = { ...s, hop: live, x: to.x, y: to.y, anchor: hop.land };
    if (s.shoutQueued) return shout(landed, now);
    if (now < s.until) {
        return { ...landed, frame: "idle", sx: SQUASH.sx, sy: SQUASH.sy };
    }
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
        if (!at) return dropFrom(s, now, { x: s.x, y: s.y });
        if (now >= s.until) return settle(s, now, rand, at, s.anchor);
        return { ...s, x: at.x, y: at.y };
    }
    const t = (now - s.phaseStart) / 1000;
    const y = s.fallFrom + 0.5 * GRAVITY * t * t;
    const hit = w.platforms
        .filter((p) => s.x >= p.left && s.x <= p.right)
        .map((p) => ({ p, top: restY(p, s.x) }))
        .filter(
            ({ top }) =>
                top >= MIN_TOP_PX && top <= w.floorY && top >= s.y && top <= y
        )
        .sort((a, b) => a.top - b.top)[0];
    if (!hit && y < w.floorY) return { ...s, y, sx: 1, sy: AIRBORNE_SY };
    const landed: PetState = hit
        ? { ...s, y: hit.top, anchor: onPlatform(hit.p, s.x, w) }
        : { ...s, y: w.floorY, anchor: FLOOR };
    if (s.shoutQueued) return shout(landed, now);
    return {
        ...landed,
        until: now + LANDING_MS,
        frame: "idle",
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
    if (!at) return dropFrom(s, now, { x: s.x, y: s.y });
    const here = { ...s, x: at.x, y: at.y };
    if (s.phase === "sleep") {
        if (now < s.until) return here;
        return settle({ ...here, hops: 0 }, now, rand, at, s.anchor);
    }
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
    if (s.hops >= TIRED_HOPS) return nap(here, now, rand);
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
        case "held":
            return s;
        case "hop":
            return stepHop(s, now, world, rand);
        case "fall":
            return stepFall(s, now, world, rand);
        default:
            return stepGrounded(s, now, world, rand);
    }
}

export function clickPet(s: PetState, now: number): PetState {
    if (s.phase === "held") return s;
    const airborne =
        s.phase === "hop" || (s.phase === "fall" && !Number.isFinite(s.until));
    if (airborne) return { ...s, shoutQueued: true };
    return shout(s.phase === "sleep" ? { ...s, hops: 0 } : s, now);
}

/** Lifts Diny from wherever it is; grabbing a sleeping Diny wakes it. */
export function pickUpPet(s: PetState, now: number, pointer: Pt): PetState {
    return {
        ...s,
        phase: "held",
        phaseStart: now,
        until: Infinity,
        frame: "held",
        sx: 1,
        sy: 1,
        hop: undefined,
        path: [],
        shoutQueued: false,
        hops: s.phase === "sleep" ? 0 : s.hops,
        grab: { x: s.x - pointer.x, y: s.y - pointer.y },
    };
}

export function carryPet(s: PetState, pointer: Pt): PetState {
    if (s.phase !== "held" || !s.grab) return s;
    return { ...s, x: pointer.x + s.grab.x, y: pointer.y + s.grab.y };
}

/** Lets go: Diny falls from where it hangs onto whatever is below, back inside the view. */
export function dropPet(s: PetState, now: number, w: World): PetState {
    if (s.phase !== "held") return s;
    return {
        ...dropFrom(s, now, { x: floorX(s.x, w), y: s.y }),
        grab: undefined,
    };
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
        fallFrom: FALL_FROM_Y,
        hops: 0,
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
    if (s.phase !== "idle" && s.phase !== "shout" && s.phase !== "sleep") {
        return s;
    }
    const outside =
        s.x + HALF_W < 0 ||
        s.x - HALF_W > w.viewW ||
        s.y < 0 ||
        s.y - PET_H > w.viewH;
    return outside ? fall(s, now, w, rand) : s;
}
