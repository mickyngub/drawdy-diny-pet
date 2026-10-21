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
