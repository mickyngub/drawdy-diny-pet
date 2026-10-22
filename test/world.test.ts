import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScreenMapping } from "../src/screen";
import { platformsFrom } from "../src/world";

const camera: ScreenMapping = { cx: 0, cy: 0, sx: 10, sy: 20, zoom: 2 };

const shape = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: "path" as const,
    x: 100,
    y: 50,
    width: 40,
    height: 30,
    rotation: 0,
    ...extra,
});

test("a flat shape becomes a platform in screen pixels", () => {
    assert.deepEqual(platformsFrom([shape("a")], camera, 60), [
        { id: "a", left: 210, right: 290, top: 120 },
    ]);
});

test("frames, tilted shapes and shapes narrower than the minimum on screen are not platforms", () => {
    const ids = platformsFrom(
        [
            shape("frame", { type: "frame", width: 400 }),
            shape("tilted", { rotation: 0.1 }),
            shape("tilted-back", { rotation: -0.1 }),
            shape("barely-tilted", { rotation: 0.04 }),
            shape("narrow", { width: 29 }),
            { id: "no-geometry", type: "text" as const },
        ],
        camera,
        60
    ).map((p) => p.id);
    assert.deepEqual(ids, ["barely-tilted"]);
});

test("the minimum width is measured on screen, so zooming out drops a shape", () => {
    const zoomedOut = { ...camera, zoom: 0.5 };
    assert.deepEqual(
        platformsFrom([shape("a", { width: 100 })], zoomedOut, 60),
        []
    );
    assert.equal(
        platformsFrom([shape("a", { width: 120 })], zoomedOut, 60).length,
        1
    );
});

const plain: ScreenMapping = { cx: 0, cy: 0, sx: 0, sy: 0, zoom: 1 };

const only = (el: Parameters<typeof platformsFrom>[0][number]) => {
    const [platform] = platformsFrom([el], plain, 60);
    assert.ok(platform, "no platform");
    return platform;
};

test("a pencil stroke stands Diny on the stroke itself, not on the top of its box", () => {
    const p = only({
        id: "peak",
        type: "freedraw",
        x: -2,
        y: 48,
        width: 104,
        height: 54,
        points: [
            [0, 100],
            [50, 50],
            [100, 100],
        ],
    });
    assert.equal(p.left, 0);
    assert.equal(p.right, 100);
    assert.equal(p.top, 50);
    assert.ok(p.ys);
    assert.equal(p.ys[0], 100);
    assert.equal(p.ys[10], 80);
    assert.equal(p.ys[25], 50);
    assert.equal(p.ys.at(-1), 100);
});

test("Diny stands on top of the stroke, half its width above the line through it", () => {
    const p = only({
        id: "thick",
        type: "freedraw",
        strokeWidth: 4,
        points: [
            [0, 100],
            [50, 50],
            [100, 100],
        ],
    });
    assert.equal(p.top, 48);
    assert.equal(p.ys?.[0], 98);
});

test("where a stroke doubles back, the upper pass is the one to stand on", () => {
    assert.deepEqual(
        only({
            id: "loop",
            type: "freedraw",
            points: [
                [0, 100],
                [100, 100],
                [100, 60],
                [0, 60],
            ],
        }),
        { id: "loop", left: 0, right: 100, top: 60 }
    );
});

test("a rotated shape is a platform along its upper edges", () => {
    const p = only({
        id: "turned",
        type: "path",
        componentType: "rect",
        rotation: Math.PI / 4,
        points: [
            [50, 0],
            [100, 50],
            [50, 100],
            [0, 50],
        ],
    });
    assert.equal(p.top, 0);
    assert.equal(p.ys?.[0], 50);
    assert.equal(p.ys?.[10], 30);
    assert.equal(p.ys?.[25], 0);
});

const box: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
];

test("a circle is a platform along the top of its ellipse", () => {
    const p = only({
        id: "o",
        type: "path",
        componentType: "circle",
        points: box,
    });
    assert.ok(p.ys);
    assert.ok(Math.abs(p.top) < 0.01, `top ${p.top}`);
    assert.ok(Math.abs(p.ys[0] - 30) < 0.01, `left end ${p.ys[0]}`);
    // On the ellipse, x = 10 sits at y = 30 - 30 * sqrt(1 - 0.8²) = 12.
    assert.ok(Math.abs(p.ys[5] - 12) < 1, `at x 10: ${p.ys[5]}`);
});

test("a diamond is a platform along its two upper sides", () => {
    const p = only({
        id: "d",
        type: "path",
        componentType: "diamond",
        points: box,
    });
    assert.equal(p.top, 0);
    assert.equal(p.ys?.[0], 30);
    assert.equal(p.ys?.[10], 18);
    assert.equal(p.ys?.[25], 0);
});

test("a straight line is a platform along the line", () => {
    const p = only({
        id: "ramp",
        type: "path",
        points: [
            [0, 100],
            [100, 60],
        ],
    });
    assert.equal(p.top, 60);
    assert.equal(p.ys?.[0], 100);
    assert.equal(p.ys?.[25], 80);
});

test("a line with one bend curves through the bend, the way Drawdy draws it", () => {
    const p = only({
        id: "arch",
        type: "path",
        points: [
            [0, 100],
            [100, 100],
            [50, 50],
        ],
    });
    assert.equal(p.top, 50);
    assert.equal(p.ys?.[0], 100);
    assert.equal(p.ys?.[25], 50);
    assert.equal(p.ys?.at(-1), 100);
});

test("a line with two bends follows a spline through both", () => {
    const p = only({
        id: "wave",
        type: "path",
        points: [
            [0, 100],
            [150, 100],
            [50, 50],
            [100, 50],
        ],
    });
    assert.equal(p.ys?.[25], 50);
    assert.equal(p.ys?.[50], 50);
    assert.ok(p.top < 50, "the spline rises between the bends");
});

test("an elbow line keeps its square corners", () => {
    const p = only({
        id: "step",
        type: "path",
        points: [
            [0, 100],
            [50, 100],
            [50, 40],
            [100, 40],
        ],
    });
    assert.equal(p.ys?.[24], 100);
    assert.equal(p.ys?.[25], 40);
    assert.equal(p.ys?.at(-1), 40);
});
