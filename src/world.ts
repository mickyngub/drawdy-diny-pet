import type { SubscribedDrawdyElement } from "@drawdy/driver-protocol";
import type { Platform } from "./pet";
import { toScreen, type Point, type ScreenMapping } from "./screen";

const MAX_TILT = 0.05;
const SAMPLE_STEP = 2;
const MAX_SAMPLES = 256;
const FLAT_PX = 0.5;
const ELLIPSE_SEGMENTS = 64;
const BEND_STEPS = 40;
const SPLINE_STEPS = 20;
const EPS = 0.001;

type Outline = { pts: Point[]; closed: boolean };

// Upper-edge heights, evenly spaced from left to right, in canvas units.
type Surface = { left: number; right: number; ys: number[] };

const surfaces = new WeakMap<SubscribedDrawdyElement, Surface | null>();

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, v));

const mid = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
});

// Closed shapes report their four box corners, already rotated.
const isBox = ([a, b, c, d]: Point[]): boolean =>
    Math.abs(a.x + c.x - b.x - d.x) < EPS &&
    Math.abs(a.y + c.y - b.y - d.y) < EPS;

const ellipse = ([a, b, , d]: Point[]): Point[] => {
    const centre = mid(b, d);
    const u = { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
    const v = { x: (d.x - a.x) / 2, y: (d.y - a.y) / 2 };
    return Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
        const t = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
        return {
            x: centre.x + u.x * Math.cos(t) + v.x * Math.sin(t),
            y: centre.y + u.y * Math.cos(t) + v.y * Math.sin(t),
        };
    });
};

const diamond = ([a, b, c, d]: Point[]): Point[] => [
    mid(a, b),
    mid(b, c),
    mid(c, d),
    mid(d, a),
];

const catmullRom = (
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number
) =>
    0.5 *
    (2 * p1 +
        (p2 - p0) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (3 * p1 - 3 * p2 + p3 - p0) * t * t * t);

const spline = (ws: Point[]): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < ws.length - 1; i++) {
        const [p0, p1, p2, p3] = [i - 1, i, i + 1, i + 2].map(
            (j) => ws[Math.min(ws.length - 1, Math.max(0, j))]
        );
        const last = i === ws.length - 2 ? SPLINE_STEPS : SPLINE_STEPS - 1;
        for (let s = 0; s <= last; s++) {
            const t = s / SPLINE_STEPS;
            out.push({
                x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
                y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
            });
        }
    }
    return out;
};

// Mirrors Drawdy's line drawing: an elbow line keeps its corners in order, any
// other line is [start, end, ...bends] drawn as a curve through the bends. The
// host does not report elbowRouting, so an all-axis-aligned route stands in for it.
const lineCurve = (pts: Point[]): Point[] => {
    const elbow = pts.every(
        (p, i) =>
            i === 0 ||
            Math.abs(p.x - pts[i - 1].x) < EPS ||
            Math.abs(p.y - pts[i - 1].y) < EPS
    );
    if (pts.length < 3 || elbow) return pts;
    const [start, end, ...bends] = pts;
    if (bends.length > 1) return spline([start, ...bends, end]);
    const c = {
        x: 2 * bends[0].x - (start.x + end.x) / 2,
        y: 2 * bends[0].y - (start.y + end.y) / 2,
    };
    return Array.from({ length: BEND_STEPS + 1 }, (_, i) => {
        const t = i / BEND_STEPS;
        const m = 1 - t;
        return {
            x: m * m * start.x + 2 * m * t * c.x + t * t * end.x,
            y: m * m * start.y + 2 * m * t * c.y + t * t * end.y,
        };
    });
};

const outlineOf = (el: SubscribedDrawdyElement): Outline | null => {
    const pts = (el.points ?? []).map(([x, y]) => ({ x, y }));
    if (el.type === "freedraw") {
        return pts.length >= 2 ? { pts, closed: false } : null;
    }
    if (el.type !== "path") return null;
    if (pts.length === 4 && isBox(pts)) {
        if (el.componentType === "circle") {
            return { pts: ellipse(pts), closed: true };
        }
        if (el.componentType === "diamond") {
            return { pts: diamond(pts), closed: true };
        }
        return { pts, closed: true };
    }
    return pts.length >= 2 ? { pts: lineCurve(pts), closed: false } : null;
};

const upperEdge = ({ pts, closed }: Outline): Surface | null => {
    const xs = pts.map((p) => p.x);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    if (!(right > left)) return null;
    const n =
        Math.min(MAX_SAMPLES, Math.ceil((right - left) / SAMPLE_STEP)) + 1;
    const step = (right - left) / (n - 1);
    const ys = new Array<number>(n).fill(Infinity);
    const segments = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < segments; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const [lo, hi] = a.x <= b.x ? [a, b] : [b, a];
        const first = Math.max(0, Math.ceil((lo.x - left) / step - EPS));
        const last = Math.min(n - 1, Math.floor((hi.x - left) / step + EPS));
        for (let i = first; i <= last; i++) {
            const x = clamp(left + i * step, lo.x, hi.x);
            const y =
                hi.x === lo.x
                    ? Math.min(lo.y, hi.y)
                    : lo.y + ((hi.y - lo.y) * (x - lo.x)) / (hi.x - lo.x);
            if (y < ys[i]) ys[i] = y;
        }
    }
    return { left, right, ys };
};

const boxTop = ({
    x,
    y,
    width,
    rotation = 0,
}: SubscribedDrawdyElement): Surface | null =>
    x === undefined ||
    y === undefined ||
    width === undefined ||
    Math.abs(rotation) >= MAX_TILT
        ? null
        : { left: x, right: x + width, ys: [y, y] };

const surfaceOf = (el: SubscribedDrawdyElement): Surface | null => {
    if (surfaces.has(el)) return surfaces.get(el) ?? null;
    const outline = outlineOf(el);
    let surface = outline ? upperEdge(outline) : boxTop(el);
    // Outlines run along the middle of the stroke; Diny stands on its top.
    const half = outline ? (el.strokeWidth ?? 0) / 2 : 0;
    if (surface && half > 0) {
        surface = { ...surface, ys: surface.ys.map((y) => y - half) };
    }
    surfaces.set(el, surface);
    return surface;
};

export function platformsFrom(
    elements: readonly SubscribedDrawdyElement[],
    camera: ScreenMapping,
    minWidthPx: number
): Platform[] {
    return elements.flatMap((el) => {
        if (el.type === "frame") return [];
        const surface = surfaceOf(el);
        if (!surface) return [];
        const left = toScreen(camera, { x: surface.left, y: 0 }).x;
        const right = toScreen(camera, { x: surface.right, y: 0 }).x;
        if (right - left < minWidthPx) return [];
        const ys = surface.ys.map((y) => toScreen(camera, { x: 0, y }).y);
        const top = Math.min(...ys);
        const flat = ys.every((y) => y - top < FLAT_PX);
        return [
            flat
                ? { id: el.id, left, right, top }
                : { id: el.id, left, right, top, ys },
        ];
    });
}
