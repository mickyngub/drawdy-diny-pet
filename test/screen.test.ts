import assert from "node:assert/strict";
import { test } from "node:test";
import { rectToScreen, toScreen, type ScreenMapping } from "../src/screen";

const atZoom = (zoom: number): ScreenMapping => ({
    cx: 100,
    cy: -50,
    sx: 300,
    sy: 200,
    zoom,
});

test("toScreen maps the reference point to its screen point and offsets 1:1 at zoom 1", () => {
    assert.deepEqual(toScreen(atZoom(1), { x: 100, y: -50 }), { x: 300, y: 200 });
    assert.deepEqual(toScreen(atZoom(1), { x: 130, y: -70 }), { x: 330, y: 180 });
});

test("toScreen scales offsets from the reference point by the zoom", () => {
    assert.deepEqual(toScreen(atZoom(2), { x: 100, y: -50 }), { x: 300, y: 200 });
    assert.deepEqual(toScreen(atZoom(2), { x: 130, y: -70 }), { x: 360, y: 160 });
});

test("rectToScreen places the top-left corner and scales width and height", () => {
    assert.deepEqual(
        rectToScreen(atZoom(2), { x: 110, y: -40, width: 50, height: 30 }),
        { x: 320, y: 220, width: 100, height: 60 }
    );
    assert.deepEqual(
        rectToScreen(atZoom(0.5), { x: 110, y: -40, width: 50, height: 30 }),
        { x: 305, y: 205, width: 25, height: 15 }
    );
});
