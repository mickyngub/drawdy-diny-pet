import type { Rect } from "./screen";

export type Pt = { x: number; y: number };

export type Anchor =
    { kind: "floor" } | { kind: "element"; id: string; offset: number };

export type Phase =
    "idle" | "hop" | "shout" | "fall" | "sleep" | "held" | "show";

export type Frame =
    | "idle"
    | "wave"
    | "jump"
    | "fall"
    | "shout"
    | "cheer"
    | "happy"
    | "thinking"
    | "draw"
    | "talk"
    | "shrug"
    | "wag"
    | "tired"
    | "sleep"
    | "held"
    | "sword"
    | "battle-cry"
    | "slash"
    | "salute"
    | "wai-kru"
    | "guard"
    | "jab"
    | "cross"
    | "kick"
    | "teep"
    | "victory";

export type Routine = "talk" | "sword" | "workout";

export type Beat = { frame: Frame; ms: number };

export type Hop = { from: Pt; to: Pt; peakY: number; land: Anchor };

// `lost` marks a goal picked after finding no shape in reach.
export type Stop = { land: Anchor; x: number; lost?: boolean };

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
    // Set while Diny falls from your hand, so it wags when it lands.
    carried?: boolean;
    lost?: boolean;
    routine?: Routine;
    // Quick clicks in a row: the second cheers, the third brings out the sword.
    clicks?: number;
    // Set once Diny has done its workout, until a nap rests it.
    trained?: boolean;
};

export type Platform = {
    id: string;
    left: number;
    right: number;
    top: number;
    // Heights of a curved top, evenly spaced from left to right; a flat top has none.
    ys?: number[];
    // A box of Drawdy's own UI, such as the minimap: it stays put on screen when the camera zooms.
    ui?: boolean;
};

export type World = {
    platforms: Platform[];
    floorY: number;
    // The board's visible area on screen; Diny never leaves it.
    view: Rect;
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
export const MOOD_CHANCE = 0.5;
export const MOODS: Frame[] = ["happy", "thinking", "draw", "talk"];
export const WORKOUT_HOPS = 10;
export const CHEER_CLICKS = 2;
export const SWORD_CLICKS = 3;

// The mascot bible keeps the sword for big moments and the gloves for energy
// streaks, every strike thrown out to the side, never at you.
export const ROUTINES: Record<Routine, Beat[]> = {
    talk: [
        { frame: "talk", ms: 180 },
        { frame: "idle", ms: 110 },
        { frame: "talk", ms: 220 },
        { frame: "idle", ms: 130 },
        { frame: "talk", ms: 160 },
        { frame: "idle", ms: 120 },
        { frame: "talk", ms: 240 },
        { frame: "idle", ms: 160 },
        { frame: "talk", ms: 180 },
    ],
    sword: [
        { frame: "sword", ms: 350 },
        { frame: "battle-cry", ms: 900 },
        { frame: "slash", ms: 450 },
        { frame: "sword", ms: 300 },
        { frame: "salute", ms: 1100 },
    ],
    workout: [
        { frame: "wai-kru", ms: 1600 },
        { frame: "guard", ms: 500 },
        { frame: "jab", ms: 250 },
        { frame: "guard", ms: 250 },
        { frame: "cross", ms: 300 },
        { frame: "guard", ms: 250 },
        { frame: "kick", ms: 450 },
        { frame: "guard", ms: 250 },
        { frame: "teep", ms: 400 },
        { frame: "guard", ms: 300 },
        { frame: "victory", ms: 1300 },
    ],
};

export const routineMs = (r: Routine): number =>
    ROUTINES[r].reduce((sum, b) => sum + b.ms, 0);

const HALF_W = PET_W / 2;
const FLOOR: Anchor = { kind: "floor" };

type Span = { lo: number; hi: number };

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, v));

const viewRight = (w: World): number => w.view.x + w.view.width;

const floorX = (x: number, w: World): number =>
    w.view.width < PET_W
        ? w.view.x + w.view.width / 2
        : clamp(x, w.view.x + HALF_W, viewRight(w) - HALF_W);

const unitOf = (p: Platform, w: World): number => (p.ui ? 1 : w.zoom);

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
        y >= w.view.y + MIN_TOP_PX &&
        y <= w.floorY &&
        Math.abs(slopeAt(p, x)) <= MAX_SLOPE
    );
};

const place = (anchor: Anchor, x: number, w: World): Pt | null => {
    if (anchor.kind === "floor") return { x: floorX(x, w), y: w.floorY };
    const p = platformOf(w, anchor.id);
    if (!p) return null;
    const at = clamp(p.left + anchor.offset * unitOf(p, w), p.left, p.right);
    return { x: at, y: restY(p, at) };
};

const onPlatform = (p: Platform, x: number, w: World): Anchor => ({
    kind: "element",
    id: p.id,
    offset: (x - p.left) / unitOf(p, w),
});

// The stretches of a platform's top, in view, gentle enough to land on.
const landingSpans = (p: Platform, w: World): Span[] => {
    const lo = Math.max(p.left, w.view.x + HALF_W);
    const hi = Math.min(p.right, viewRight(w) - HALF_W);
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

const restingFrame = (s: PetState, rand: () => number): Frame => {
    if (s.hops >= TIRED_HOPS) return "tired";
    if (s.greet) return "wave";
    if (s.carried) return "wag";
    const r = rand();
    if (r >= MOOD_CHANCE) return "idle";
    if (s.lost) return "shrug";
    return MOODS[Math.floor((r / MOOD_CHANCE) * MOODS.length)];
};

const perform = (s: PetState, now: number, routine: Routine): PetState => ({
    ...s,
    phase: "show",
    phaseStart: now,
    until: now + routineMs(routine),
    frame: ROUTINES[routine][0].frame,
    routine,
    sx: 1,
    sy: 1,
    hop: undefined,
    path: [],
    shoutQueued: false,
});

const beatAt = (beats: Beat[], t: number): Frame => {
    let end = 0;
    for (const b of beats) {
        end += b.ms;
        if (t < end) return b.frame;
    }
    return beats[beats.length - 1].frame;
};

const rested = (s: PetState): PetState => ({ ...s, hops: 0, trained: false });

const settle = (
    s: PetState,
    now: number,
    rand: () => number,
    at: Pt,
    anchor: Anchor
): PetState => {
    const rest: PetState = {
        ...s,
        phase: "idle",
        x: at.x,
        y: at.y,
        anchor,
        phaseStart: now,
        until: now + idleFor(rand),
        frame: restingFrame(s, rand),
        sx: 1,
        sy: 1,
        hop: undefined,
        path: [],
        shoutQueued: false,
        greet: false,
        carried: false,
        lost: false,
        routine: undefined,
        clicks: 0,
    };
    return rest.frame === "talk" ? perform(rest, now, "talk") : rest;
};

const nap = (s: PetState, now: number, rand: () => number): PetState => ({
    ...s,
    phase: "sleep",
    phaseStart: now,
    until: now + SLEEP_MIN_MS + rand() * (SLEEP_MAX_MS - SLEEP_MIN_MS),
    frame: "sleep",
    sx: 1,
    sy: 1,
});

const shout = (s: PetState, now: number, clicks = 1): PetState => ({
    ...s,
    phase: "shout",
    phaseStart: now,
    until: now + SHOUT_MS,
    frame: clicks >= CHEER_CLICKS ? "cheer" : "shout",
    sx: POP_SCALE,
    sy: POP_SCALE,
    hop: undefined,
    path: [],
    shoutQueued: false,
    carried: false,
    lost: false,
    routine: undefined,
    clicks,
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
        x: floorX(w.view.x + HALF_W + rand() * (w.view.width - PET_W), w),
        y: w.view.y + FALL_FROM_Y,
    }),
    greet: true,
});

const pickGoal = (s: PetState, w: World, rand: () => number): Stop => {
    const looked = rand() < HOP_CHANCE;
    if (looked) {
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
        lost: looked,
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
                top >= w.view.y + MIN_TOP_PX &&
                top <= w.floorY &&
                top >= s.y &&
                top <= y
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
        return settle(rested(here), now, rand, at, s.anchor);
    }
    if (s.phase === "shout") {
        if (now >= s.until) return settle(here, now, rand, at, s.anchor);
        const t = now - s.phaseStart;
        const pop = t < POP_MS ? POP_SCALE : 1;
        const cheering = (s.clicks ?? 1) >= CHEER_CLICKS;
        return {
            ...here,
            frame: cheering
                ? "cheer"
                : Math.floor(t / SHOUT_FRAME_MS) % 2 === 0
                  ? "shout"
                  : "idle",
            sx: pop,
            sy: pop,
        };
    }
    if (s.phase === "show") {
        if (now >= s.until) return settle(here, now, rand, at, s.anchor);
        return {
            ...here,
            frame: beatAt(ROUTINES[s.routine!], now - s.phaseStart),
        };
    }
    if (now < s.until) return here;
    if (w.view.width < NARROW_PX) {
        return settle(here, now, rand, at, s.anchor);
    }
    if (s.hops >= TIRED_HOPS) return nap(here, now, rand);
    if (s.hops >= WORKOUT_HOPS && !s.trained) {
        return perform({ ...here, trained: true }, now, "workout");
    }
    const goal = pickGoal(here, w, rand);
    const path = planPath(here, goal, w);
    return takeOff({ ...here, path, lost: goal.lost }, now, w, rand);
};

export function stepPet(
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState {
    const world = w.view.width < NARROW_PX ? { ...w, platforms: [] } : w;
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

/** Each click while Diny still shouts builds the streak: a shout, a cheer, then the sword. */
export function clickPet(s: PetState, now: number): PetState {
    if (s.phase === "held") return s;
    if (s.phase === "show" && s.routine === "sword") return s;
    const airborne =
        s.phase === "hop" || (s.phase === "fall" && !Number.isFinite(s.until));
    if (airborne) return { ...s, shoutQueued: true };
    if (s.phase === "shout") {
        const clicks = (s.clicks ?? 1) + 1;
        if (clicks >= SWORD_CLICKS) {
            return perform({ ...s, clicks: 0 }, now, "sword");
        }
        return shout(s, now, clicks);
    }
    return shout(s.phase === "sleep" ? rested(s) : s, now);
}

/** Lifts Diny from wherever it is; grabbing a sleeping Diny wakes it. */
export function pickUpPet(s: PetState, now: number, pointer: Pt): PetState {
    return {
        ...(s.phase === "sleep" ? rested(s) : s),
        phase: "held",
        phaseStart: now,
        until: Infinity,
        frame: "held",
        sx: 1,
        sy: 1,
        hop: undefined,
        path: [],
        shoutQueued: false,
        lost: false,
        routine: undefined,
        clicks: 0,
        grab: { x: s.x - pointer.x, y: s.y - pointer.y },
    };
}

/** Diny hangs from the pointer but stays inside the board, however far the pointer goes. */
export function carryPet(s: PetState, pointer: Pt, w: World): PetState {
    if (s.phase !== "held" || !s.grab) return s;
    return {
        ...s,
        x: floorX(pointer.x + s.grab.x, w),
        y: clamp(pointer.y + s.grab.y, w.view.y + PET_H, w.floorY),
    };
}

/** Lets go: Diny falls from where it hangs onto whatever is below, back inside the view. */
export function dropPet(s: PetState, now: number, w: World): PetState {
    if (s.phase !== "held") return s;
    return {
        ...dropFrom(s, now, { x: floorX(s.x, w), y: s.y }),
        grab: undefined,
        carried: true,
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

/**
 * Drops a standing pet back in from the top when its spot has left the view,
 * and nudges it off a board edge it pokes past, so it falls onto what is below.
 */
export function recallPet(
    s: PetState,
    now: number,
    w: World,
    rand: () => number
): PetState {
    const standing = ["idle", "shout", "sleep", "show"];
    if (!standing.includes(s.phase)) return s;
    const outside =
        s.x + HALF_W < w.view.x ||
        s.x - HALF_W > viewRight(w) ||
        s.y < w.view.y ||
        s.y - PET_H > w.view.y + w.view.height;
    if (outside) return fall(s, now, w, rand);
    const inside = floorX(s.x, w);
    return inside === s.x ? s : dropFrom(s, now, { x: inside, y: s.y });
}
