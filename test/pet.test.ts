import assert from "node:assert/strict";
import { test } from "node:test";
import {
    carryPet,
    clickPet,
    dropPet,
    pickUpPet,
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
    SLEEP_MAX_MS,
    SLEEP_MIN_MS,
    TAKEOFF_MS,
    TIRED_HOPS,
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
    fallFrom: 0,
    hops: 0,
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

test("a pet whose shape disappears drops straight down from where it stood and lands on the floor", () => {
    const pet = standing(1200, 600, { kind: "element", id: "p", offset: 100 });
    const visits = run({ ...pet, until: 9999 }, 0, 3000, world());
    const falling = visits.filter((v) => v.s.phase === "fall");
    assert.equal(falling[0].at, 0);
    assert.equal(falling[0].s.y, 600);
    assert.ok(falling.every((v) => v.s.x === 1200));
    assert.ok(falling[1].s.y > 600);
    assert.ok(falling.every((v, i) => i === 0 || v.s.y >= falling[i - 1].s.y));
    const landed = firstWhen(visits, (s) => s.phase === "idle").s;
    assert.equal(landed.x, 1200);
    assert.equal(landed.y, FLOOR_Y);
    assert.deepEqual(landed.anchor, { kind: "floor" });
});

test("a pet whose shape disappears lands on the first shape below it", () => {
    const pet = standing(1200, 300, {
        kind: "element",
        id: "gone",
        offset: 100,
    });
    const below = world([{ id: "below", left: 1100, right: 1300, top: 700 }]);
    const visits = run({ ...pet, until: 9999 }, 0, 3000, below);
    const landed = firstWhen(visits, (s) => s.phase === "idle").s;
    assert.equal(landed.x, 1200);
    assert.equal(landed.y, 700);
    assert.equal(landed.anchor.kind === "element" && landed.anchor.id, "below");
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
    assert.equal(gone.y, FALL_FROM_Y);
    const inView = onFloor(800);
    assert.equal(recallPet(inView, 0, w, fixed(0.5)), inView);
});

test("on a curved top the feet rest on the highest point under them, and Diny rides the curve", () => {
    const hill: Platform = {
        id: "hill",
        left: 1000,
        right: 1400,
        top: 500,
        ys: [700, 500, 700],
    };
    const pet = standing(1100, 600, {
        kind: "element",
        id: "hill",
        offset: 100,
    });
    const next = stepPet(
        { ...pet, until: 5000 },
        10,
        world([hill]),
        fixed(0.5)
    );
    assert.equal(next.x, 1100);
    // The feet span 1084 to 1116; the curve is highest at 1116, at 700 - 200 * 116 / 200.
    assert.equal(next.y, 584);
});

test("a hop onto a curved top lands on its gentle stretch, not on the steep side", () => {
    const ramp: Platform = {
        id: "ramp",
        left: 1000,
        right: 1400,
        top: 500,
        ys: [900, 500, 500],
    };
    const visits = run(onFloor(1000), 0, 4000, world([ramp]));
    const landed = firstWhen(
        visits.filter((v) => v.at > 0),
        (s) => s.phase === "idle"
    ).s;
    assert.equal(landed.anchor.kind === "element" && landed.anchor.id, "ramp");
    assert.ok(landed.x > 1200, `landed at ${landed.x}`);
    assert.equal(landed.y, 500);
});

test("a falling pet lands on a sloped top at the height under its feet", () => {
    const slope: Platform = {
        id: "slope",
        left: 700,
        right: 900,
        top: 300,
        ys: [500, 300],
    };
    const w = world([slope]);
    const landed = firstWhen(
        run(spawnPet(0, w, fixed(0.5)), 0, 3000, w),
        (s) => s.phase === "idle"
    ).s;
    assert.equal(landed.x, 800);
    assert.equal(landed.y, 384);
    assert.equal(landed.anchor.kind === "element" && landed.anchor.id, "slope");
});

test("Diny looks tired once it has hopped 20 times", () => {
    const visits = run(
        { ...onFloor(800), hops: TIRED_HOPS - 1 },
        0,
        2000,
        world(),
        fixed(0.9)
    );
    const rested = firstWhen(
        visits.filter((v) => v.at > 0),
        (s) => s.phase === "idle"
    ).s;
    assert.ok(rested.hops >= TIRED_HOPS);
    assert.equal(rested.frame, "tired");
});

test("a tired Diny naps on the spot instead of hopping, then wakes up rested", () => {
    const w = world();
    const tired = {
        ...onFloor(800),
        hops: TIRED_HOPS,
        frame: "tired" as const,
    };
    const napping = stepPet(tired, 10, w, fixed(0.5));
    assert.equal(napping.phase, "sleep");
    assert.equal(napping.frame, "sleep");
    assert.equal(napping.x, 800);
    assert.equal(napping.y, FLOOR_Y);
    const wakeAt = 10 + SLEEP_MIN_MS + 0.5 * (SLEEP_MAX_MS - SLEEP_MIN_MS);
    assert.equal(stepPet(napping, wakeAt - 1, w, fixed(0.5)).phase, "sleep");
    const awake = stepPet(napping, wakeAt, w, fixed(0.5));
    assert.equal(awake.phase, "idle");
    assert.equal(awake.frame, "idle");
    assert.equal(awake.hops, 0);
});

test("clicking a sleeping Diny wakes it with a shout, rested", () => {
    const w = world();
    const napping = stepPet(
        { ...onFloor(800), hops: TIRED_HOPS },
        10,
        w,
        fixed(0.5)
    );
    const woken = clickPet(napping, 20);
    assert.equal(woken.phase, "shout");
    assert.equal(woken.hops, 0);
    assert.equal(stepPet(woken, 20 + SHOUT_MS, w, fixed(0.5)).frame, "idle");
});

test("a picked-up Diny hangs from the pointer where it was grabbed and ignores time and clicks", () => {
    const held = pickUpPet(onFloor(800), 0, { x: 790, y: 950 });
    assert.equal(held.phase, "held");
    assert.equal(held.frame, "held");
    const carried = carryPet(held, { x: 400, y: 300 });
    assert.equal(carried.x, 410);
    assert.equal(carried.y, 334);
    assert.equal(stepPet(carried, 5000, world(), fixed(0.5)), carried);
    assert.equal(clickPet(carried, 5000), carried);
});

test("grabbing a sleeping Diny wakes it", () => {
    const napping = stepPet(
        { ...onFloor(800), hops: TIRED_HOPS },
        10,
        world(),
        fixed(0.5)
    );
    assert.equal(pickUpPet(napping, 20, { x: 800, y: 950 }).hops, 0);
});

test("letting go drops Diny from where it hangs onto the shape below", () => {
    const w = world([{ id: "p", left: 300, right: 500, top: 600 }]);
    const held = pickUpPet(onFloor(800), 0, { x: 790, y: 950 });
    const dropped = dropPet(carryPet(held, { x: 400, y: 300 }), 100, w);
    assert.equal(dropped.phase, "fall");
    assert.equal(dropped.x, 410);
    assert.equal(dropped.y, 334);
    const landed = firstWhen(
        run(dropped, 100, 3000, w),
        (s) => s.phase === "idle"
    ).s;
    assert.equal(landed.x, 410);
    assert.equal(landed.y, 600);
    assert.equal(landed.anchor.kind === "element" && landed.anchor.id, "p");
});

test("a Diny let go outside the view falls back inside it", () => {
    const held = pickUpPet(onFloor(800), 0, { x: 800, y: 950 });
    const dropped = dropPet(carryPet(held, { x: -200, y: 300 }), 100, world());
    assert.equal(dropped.x, 48);
});
