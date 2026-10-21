import assert from "node:assert/strict";
import { test } from "node:test";
import {
    clickPet,
    recallPet,
    spawnPet,
    stepPet,
    FALL_FROM_Y,
    HOP_MAX_DX,
    HOP_MS,
    IDLE_MAX_MS,
    IDLE_MIN_MS,
    POP_SCALE,
    SHOUT_FRAME_MS,
    SHOUT_MS,
    TAKEOFF_MS,
    type Anchor,
    type PetState,
    type Platform,
    type World,
} from "../src/pet";

const FLOOR_Y = 984;

const world = (platforms: Platform[] = [], viewW = 1600): World => ({
    platforms,
    floorY: FLOOR_Y,
    viewW,
    viewH: 1000,
    zoom: 1,
});

const fixed = (value: number) => () => value;

const standing = (x: number, y: number, anchor: Anchor): PetState => ({
    phase: "idle",
    x,
    y,
    facing: 1,
    anchor,
    phaseStart: 0,
    until: 0,
    frame: "idle",
    sx: 1,
    sy: 1,
    path: [],
    shoutQueued: false,
});

const onFloor = (x: number): PetState =>
    standing(x, FLOOR_Y, { kind: "floor" });

type Visit = { at: number; s: PetState };

// Steps a millisecond at a time, the way a fast loop would.
const run = (
    s: PetState,
    from: number,
    to: number,
    w: World,
    rand = fixed(0.5)
): Visit[] => {
    const visits: Visit[] = [];
    let current = s;
    for (let at = from; at <= to; at++) {
        current = stepPet(current, at, w, rand);
        visits.push({ at, s: current });
    }
    return visits;
};

const firstWhen = (visits: Visit[], when: (s: PetState) => boolean): Visit => {
    const found = visits.find((v) => when(v.s));
    assert.ok(found, "the expected state never came");
    return found;
};

const hopsOf = (visits: Visit[]): Visit[][] => {
    const hops = new Map<number, Visit[]>();
    for (const v of visits) {
        if (v.s.phase !== "hop") continue;
        hops.set(v.s.phaseStart, [...(hops.get(v.s.phaseStart) ?? []), v]);
    }
    return [...hops.values()];
};

const at = (s: PetState, p: { x: number; y: number }): boolean =>
    s.x === p.x && s.y === p.y;

test("idle lasts between 1.5 and 4 seconds", () => {
    for (const r of [0, 0.5, 0.999]) {
        const visits = run(
            spawnPet(0, world(), fixed(r)),
            0,
            8000,
            world(),
            fixed(r)
        );
        const idle = firstWhen(visits, (s) => s.phase === "idle");
        const next = firstWhen(
            visits.filter((v) => v.at > idle.at),
            (s) => s.phase !== "idle"
        );
        const lasted = next.at - idle.at;
        assert.ok(
            lasted >= IDLE_MIN_MS && lasted <= IDLE_MAX_MS,
            `idle lasted ${lasted} ms`
        );
        if (r === 0) assert.equal(lasted, IDLE_MIN_MS);
    }
});

for (const [direction, shape] of [
    ["right", { id: "p", left: 1100, right: 1300, top: 600 }],
    ["left", { id: "p", left: 300, right: 500, top: 600 }],
] as const) {
    test(`a trip to a shape on the ${direction} goes in hops of at most 160 px, 420 ms in the air, facing the way they go`, () => {
        const w = world([shape]);
        const hops = hopsOf(run(onFloor(800), 0, 4000, w));
        assert.equal(hops.length, 3);
        for (const visits of hops) {
            const { from, to } = visits[visits.length - 1].s.hop!;
            const dx = to.x - from.x;
            assert.ok(Math.abs(dx) <= HOP_MAX_DX, `a hop of ${dx} px`);
            const leftAt = visits.filter((v) => at(v.s, from)).at(-1)!.at;
            const landedAt = visits.find((v) => at(v.s, to))!.at;
            assert.equal(leftAt - visits[0].at, TAKEOFF_MS);
            assert.equal(landedAt - leftAt, HOP_MS);
            assert.ok(
                visits.every((v) => v.s.facing === Math.sign(dx)),
                "faces the way it hops"
            );
        }
    });
}

test("a hop onto a shape lands with the feet on its top and stays anchored to it", () => {
    const shape = { id: "p", left: 1100, right: 1300, top: 600 };
    const visits = run(onFloor(800), 0, 4000, world([shape]));
    const landed = firstWhen(
        visits.filter((v) => v.at > 0),
        (s) => s.phase === "idle"
    ).s;
    assert.equal(landed.y, shape.top);
    assert.deepEqual(landed.anchor, { kind: "element", id: "p", offset: 100 });
});

test("a pet on a shape follows it when the shape moves on screen", () => {
    const pet = standing(1200, 600, { kind: "element", id: "p", offset: 100 });
    const moved = world([{ id: "p", left: 900, right: 1100, top: 450 }]);
    const next = stepPet({ ...pet, until: 5000 }, 10, moved, fixed(0.5));
    assert.equal(next.x, 1000);
    assert.equal(next.y, 450);
});

test("clicking makes Diny shout for 1.2 s with the frames alternating, then go idle", () => {
    const w = world();
    const shouting = clickPet({ ...onFloor(800), until: 99999 }, 1000);
    assert.equal(shouting.phase, "shout");
    const step = (dt: number) => stepPet(shouting, 1000 + dt, w, fixed(0.5));
    assert.equal(step(0).frame, "shout");
    assert.equal(step(0).sx, POP_SCALE);
    assert.equal(step(SHOUT_FRAME_MS).frame, "idle");
    assert.equal(step(SHOUT_FRAME_MS * 2).frame, "shout");
    assert.equal(step(200).sx, 1);
    assert.equal(step(SHOUT_MS - 1).phase, "shout");
    const after = step(SHOUT_MS);
    assert.equal(after.phase, "idle");
    assert.equal(after.frame, "idle");
});

test("a click mid-hop starts the shout on landing", () => {
    const w = world();
    const visits = run(onFloor(800), 0, 100, w, fixed(0.9));
    const hopping = visits.at(-1)!.s;
    assert.equal(hopping.phase, "hop");
    const clicked = clickPet(hopping, 100);
    assert.equal(clicked.phase, "hop");
    const rest = run(clicked, 101, 1000, w, fixed(0.9));
    const shout = firstWhen(rest, (s) => s.phase === "shout");
    assert.equal(shout.at, hopping.phaseStart + TAKEOFF_MS + HOP_MS);
    assert.equal(shout.s.y, FLOOR_Y);
});

test("a pet whose shape leaves the world falls in from the top and lands on the floor", () => {
    const pet = standing(1200, 600, { kind: "element", id: "p", offset: 100 });
    const falling = stepPet({ ...pet, until: 9999 }, 0, world(), fixed(0.5));
    assert.equal(falling.phase, "fall");
    assert.equal(falling.y, FALL_FROM_Y);
    const landed = firstWhen(
        run(falling, 1, 3000, world()),
        (s) => s.phase === "idle"
    ).s;
    assert.deepEqual(landed.anchor, { kind: "floor" });
    assert.equal(landed.y, FLOOR_Y);
});

test("a falling pet lands on the first shape below it that is not too near the top", () => {
    const w = world([
        { id: "low", left: 700, right: 900, top: 500 },
        { id: "high", left: 700, right: 900, top: 300 },
        { id: "too-high", left: 700, right: 900, top: 20 },
    ]);
    const landed = firstWhen(
        run(spawnPet(0, w, fixed(0.5)), 0, 3000, w),
        (s) => s.phase === "idle"
    ).s;
    assert.equal(landed.x, 800);
    assert.equal(landed.y, 300);
    assert.equal(landed.anchor.kind === "element" && landed.anchor.id, "high");
});

test("with no shape in reach, hops stay on the floor", () => {
    const far = world([{ id: "far", left: 1500, right: 1600, top: 600 }]);
    const visits = run(onFloor(300), 0, 3000, far, fixed(0.5));
    assert.ok(visits.some((v) => v.s.phase === "hop"));
    assert.ok(
        visits.every((v) => v.s.y <= FLOOR_Y && v.s.anchor.kind === "floor")
    );
});

test("a window narrower than 200 px keeps Diny idle on the floor", () => {
    const w = world([{ id: "p", left: 0, right: 180, top: 500 }], 180);
    const visits = run(spawnPet(0, w, fixed(0.5)), 0, 12000, w, fixed(0.2));
    const landed = firstWhen(visits, (s) => s.phase === "idle");
    const after = visits.filter((v) => v.at >= landed.at);
    assert.ok(after.every((v) => v.s.phase === "idle"));
    assert.ok(
        after.every((v) => v.s.anchor.kind === "floor" && v.s.y === FLOOR_Y)
    );
});

test("a standing pet whose spot left the view drops back in; one in view stays", () => {
    const w = world();
    const gone = recallPet(onFloor(-200), 0, w, fixed(0.5));
    assert.equal(gone.phase, "fall");
    const inView = onFloor(800);
    assert.equal(recallPet(inView, 0, w, fixed(0.5)), inView);
});
