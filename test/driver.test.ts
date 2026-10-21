import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { DriverManifest } from "@drawdy/driver-protocol";
import * as driver from "../src/index";
import { DINY_SHOUT } from "../src/sprite-data";
import { boot, fakeHost, schemaNodes, type FakeHost } from "./fake-host";

const manifest = {
    driverId: "mickyngub.diny-pet",
    driverName: "Diny Pet",
    driverVersion: "1.0.0",
} as DriverManifest;

const PET = `${manifest.driverId}:diny`;
const BUTTON = `${manifest.driverId}:button`;
const TICK_MS = 16;
const WARMUP_MS = 240;
// Window 1600 × 1000: the floor is at 984 and the pet's box is 96 × 85 above its feet.
const FLOOR_TOP = 984 - 85;

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
};

const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += TICK_MS) {
        mock.timers.tick(TICK_MS);
        await settle();
    }
};

const sentOf = (host: FakeHost, type: string) =>
    host.sent.filter((s) => s.type === type).length;

const start = async (host: FakeHost) => {
    const { emit } = await boot(driver, host, manifest);
    await emit("subscription:dom:element-clicked", {
        domElementId: BUTTON,
        clientX: 0,
        clientY: 0,
    });
    await settle();
    await advance(WARMUP_MS);
    return emit;
};

beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
    mock.method(Math, "random", () => 0.5);
});

afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
});

test("activate reads the remembered toggle and watches nothing on the board while Diny is away", async () => {
    const host = fakeHost();
    await boot(driver, host, manifest);
    await settle();
    assert.ok(host.types().includes("command:kv-storage:get"));
    assert.ok(!host.types().some((t) => t.startsWith("subscription:scene")));
    assert.ok(!host.types().some((t) => t.startsWith("subscription:camera")));
    assert.equal(host.floating.has(PET), false);
});

test("toggling on creates the pet as a fixed overlay that only takes clicks on its own box, and remembers it", async () => {
    const host = fakeHost();
    await start(host);
    const pet = host.floating.get(PET);
    assert.ok(pet);
    assert.equal(pet.asPopover, false);
    const [root, ...rest] = schemaNodes(pet.schema);
    assert.equal(root.styles?.pointerEvents, "auto");
    assert.deepEqual(root.styles?.width, [96, "px"]);
    assert.deepEqual(root.styles?.height, [85, "px"]);
    assert.ok(rest.every((node) => node.styles?.pointerEvents === "none"));
    assert.ok(rest.every((node) => node.domId === undefined));
    assert.deepEqual(host.kv.settings, { enabled: true });
});

test("Diny appears on load when it was left on", async () => {
    const host = fakeHost({ kv: { settings: { enabled: true } } });
    await boot(driver, host, manifest);
    await settle();
    await advance(WARMUP_MS);
    assert.equal(host.floating.get(PET)?.asPopover, false);
});

test("toggling off removes the pet at once and stops the loop", async () => {
    const host = fakeHost();
    const emit = await start(host);
    await advance(200);
    await emit("subscription:dom:element-clicked", {
        domElementId: BUTTON,
        clientX: 0,
        clientY: 0,
    });
    await settle();
    assert.equal(host.floating.has(PET), false);
    assert.deepEqual(host.kv.settings, { enabled: false });
    host.clear();
    await advance(500);
    assert.equal(sentOf(host, "command:dom:update-floating-element"), 0);
    assert.equal(sentOf(host, "command:dom:upsert-floating-element"), 0);
});

test("a camera move carries a pet standing on a shape", async () => {
    const host = fakeHost();
    host.put({
        drawdyElementId: "shelf",
        type: "path",
        x: 0,
        y: 500,
        width: 1600,
        height: 100,
    });
    const emit = await start(host);
    await advance(1200);
    assert.deepEqual(host.floating.get(PET)?.position, { x: 752, y: 415 });

    host.moveCamera({ x: 200, y: 100, zoom: 1 });
    await emit("subscription:camera:moved-rapid", { x: 200, y: 100, zoom: 1 });
    await settle();
    assert.deepEqual(host.floating.get(PET)?.position, { x: 552, y: 315 });
});

test("a pet whose shape is deleted falls back to the floor", async () => {
    const host = fakeHost();
    host.put({
        drawdyElementId: "shelf",
        type: "path",
        x: 0,
        y: 500,
        width: 1600,
        height: 100,
    });
    const emit = await start(host);
    await advance(1200);
    host.remove("shelf");
    await emit("subscription:scene:elements-removed", {
        drawdyElements: [{ id: "shelf" }],
        properties: [],
    });
    await advance(400 + 1300);
    assert.equal(host.floating.get(PET)?.position.y, FLOOR_TOP);
});

test("without the scene permission Diny keeps to the floor and reports no error", async () => {
    const errors = mock.method(console, "error", () => undefined);
    const host = fakeHost({ denied: ["command:scene"] });
    host.put({
        drawdyElementId: "shelf",
        type: "path",
        x: 0,
        y: 500,
        width: 1600,
        height: 100,
    });
    await start(host);
    await advance(1300);
    assert.equal(host.floating.get(PET)?.position.y, FLOOR_TOP);
    assert.equal(errors.mock.callCount(), 0);
});

test("clicking the pet shows the shouting frame", async () => {
    const host = fakeHost();
    const emit = await start(host);
    await advance(1300);
    await emit("subscription:dom:element-clicked", {
        domElementId: PET,
        clientX: 0,
        clientY: 0,
    });
    await settle();
    const [, image] = schemaNodes(host.floating.get(PET)!.schema);
    assert.equal(image.type === "image" && image.child, DINY_SHOUT);
});

test("at most one pet update is in flight", async () => {
    const host = fakeHost();
    await start(host);
    await advance(2 * TICK_MS);
    const release = host.hold("command:dom:update-floating-element");
    const before = sentOf(host, "command:dom:update-floating-element");
    await advance(10 * TICK_MS);
    assert.equal(
        sentOf(host, "command:dom:update-floating-element"),
        before + 1
    );
    release();
    await settle();
    await advance(2 * TICK_MS);
    assert.ok(sentOf(host, "command:dom:update-floating-element") > before + 1);
});
