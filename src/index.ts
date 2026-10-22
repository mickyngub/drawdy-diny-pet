import type {
    DomElementSchema,
    DriverCommandIssuer,
    DriverModule,
    ProtocolCommandError,
    SubscribeableKey,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import {
    carryPet,
    clickPet,
    dropPet,
    pickUpPet,
    recallPet,
    spawnPet,
    stepPet,
    PET_H,
    PET_W,
    type Frame,
    type PetState,
    type World,
} from "./pet";
import type { Point, Rect, ScreenMapping } from "./screen";
import { ACTION_BUTTON_SVG, ALL_SPRITES, PET_SPRITES } from "./sprites";
import { platformsFrom } from "./world";

const LOG = "[mickyngub.diny-pet]";
const BUTTON_RETRIES_MS = [800, 2000, 4000, 8000, 15000];
const TICK_MS = 16;
const EDIT_SETTLE_MS = 400;
const MIN_PLATFORM_PX = 60;
const FLOOR_GAP_PX = 16;
const BOARD_POLL_MS = 500;
const BOARD_SLACK_PX = 1;
const BOARD_ID = "drawdy-board";
const MINIMAP_ID = "drawdy-minimap";
const WARMUP_MS = 240;
// Drawdy starts a drag on the first pointer move, so a shaky click must not lift Diny.
const PICKUP_PX = 4;
const CLICK_AFTER_DROP_MS = 300;
const WARMUP_POSITION: Point = { x: -10000, y: -10000 };
const WARMUP_SIZE = 4;
const SETTINGS_KEY = "settings";
const ELEMENT_PROPERTIES: SubscribeableKey[] = [
    "type",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "points",
    "componentType",
    "strokeWidth",
];
const ORIGIN: Point = { x: 0, y: 0 };

let issue: DriverCommandIssuer;
let driverId: string;
let seq = 0;

const stamp = () => ({ driverId, requestId: String(seq++) });

const unwrap = <V>(response: {
    res: { error?: ProtocolCommandError; value?: V };
}): V => {
    const { error } = response.res;
    if (error !== undefined) {
        throw new Error(error.message ?? error.type);
    }
    return response.res.value as V;
};

type Live = {
    pet: PetState;
    tick: ReturnType<typeof setInterval> | null;
    poll: ReturnType<typeof setInterval> | null;
    sent: string;
    inFlight: boolean;
    created: boolean;
};

let enabled = false;
let generation = 0;
let live: Live | null = null;
let watching = false;
let elements: readonly SubscribedDrawdyElement[] = [];
let mapping: ScreenMapping = { cx: 0, cy: 0, sx: 0, sy: 0, zoom: 1 };
let board: Rect = { x: 0, y: 0, width: 0, height: 0 };
let minimap: Rect | null = null;
let world: World = {
    platforms: [],
    floorY: 0,
    view: board,
    zoom: 1,
};
let editTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshDirty = false;
let following = false;
let followZoom: number | null = null;
let drag: { from: Point; lifted: boolean } | null = null;
let clickIgnoredUntil = 0;

const buttonId = (): string => `${driverId}:button`;

const petId = (): string => `${driverId}:diny`;

const rebuildWorld = (): void => {
    world = {
        platforms: [
            ...platformsFrom(elements, mapping, MIN_PLATFORM_PX),
            ...(minimap
                ? [
                      {
                          id: MINIMAP_ID,
                          left: minimap.x,
                          right: minimap.x + minimap.width,
                          top: minimap.y,
                          ui: true,
                      },
                  ]
                : []),
        ],
        floorY: board.y + board.height - FLOOR_GAP_PX,
        view: board,
        zoom: mapping.zoom,
    };
};

const readCamera = async (zoom?: number): Promise<ScreenMapping> => {
    const z =
        zoom ??
        unwrap(await issue({ type: "command:camera:get-info", ...stamp() }))
            .zoom;
    const screen = unwrap(
        await issue({
            type: "command:camera:canvas-to-screen",
            ...stamp(),
            req: ORIGIN,
        })
    );
    return { cx: ORIGIN.x, cy: ORIGIN.y, sx: screen.x, sy: screen.y, zoom: z };
};

const readViewport = async (): Promise<Rect> =>
    unwrap(
        await issue({ type: "command:camera:get-viewport-rect", ...stamp() })
    ).rect;

const canvasToScreen = async (p: Point): Promise<Point> =>
    unwrap(
        await issue({
            type: "command:camera:canvas-to-screen",
            ...stamp(),
            req: p,
        })
    );

// Both corners are converted right after the viewport is read, so a moving camera barely skews the result.
const boardOf = async (viewport: Rect): Promise<Rect> => {
    const [topLeft, bottomRight] = await Promise.all([
        canvasToScreen(viewport),
        canvasToScreen({
            x: viewport.x + viewport.width,
            y: viewport.y + viewport.height,
        }),
    ]);
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };
};

// Hosts before these ids existed, and a hidden minimap, report none.
const readRect = async (elementId: string): Promise<Rect | null> => {
    try {
        const rect = unwrap(
            await issue({
                type: "command:dom:element-rect",
                ...stamp(),
                req: { elementId },
            })
        );
        return rect.width > 0 && rect.height > 0 ? rect : null;
    } catch {
        return null;
    }
};

// The canvas stays window-sized behind the frame, which clips it once the sidebar opens.
const readBoard = async (viewport?: Rect): Promise<Rect> =>
    (await readRect(BOARD_ID)) ?? boardOf(viewport ?? (await readViewport()));

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
    a === b ||
    (a !== null &&
        b !== null &&
        (["x", "y", "width", "height"] as const).every(
            (k) => Math.abs(a[k] - b[k]) <= BOARD_SLACK_PX
        ));

const readElements = async (
    rect: Rect
): Promise<readonly SubscribedDrawdyElement[]> => {
    try {
        const { drawdyElements: hits } = unwrap(
            await issue({
                type: "command:scene:query-rect",
                ...stamp(),
                req: { rect, properties: ["type"] },
            })
        );
        const ids = hits.filter((el) => el.type !== "frame").map((el) => el.id);
        if (ids.length === 0) return [];
        return unwrap(
            await issue({
                type: "command:scene:get-drawdy-elements",
                ...stamp(),
                req: { drawdyElementIds: ids, properties: ELEMENT_PROPERTIES },
            })
        ).drawdyElements;
    } catch {
        // Without the scene permission Diny keeps to the floor.
        return [];
    }
};

const refreshWorld = async (): Promise<void> => {
    if (refreshing) {
        refreshDirty = true;
        return;
    }
    refreshing = true;
    try {
        do {
            refreshDirty = false;
            const viewport = await readViewport();
            [board, minimap] = await Promise.all([
                readBoard(viewport),
                readRect(MINIMAP_ID),
            ]);
            elements = await readElements(viewport);
            mapping = await readCamera();
        } while (refreshDirty);
    } finally {
        refreshing = false;
    }
    rebuildWorld();
    if (live) live.pet = recallPet(live.pet, Date.now(), world, Math.random);
};

const refreshQuietly = (): void => {
    void refreshWorld().catch(() => undefined);
};

// Opening the sidebar or folding the minimap moves them without a window resize or a camera move.
const checkBoard = async (active: Live): Promise<void> => {
    if (live !== active || refreshing) return;
    const [nextBoard, nextMinimap] = await Promise.all([
        readBoard(),
        readRect(MINIMAP_ID),
    ]);
    if (live !== active || refreshing) return;
    if (!sameRect(nextBoard, board)) {
        refreshQuietly();
    } else if (!sameRect(nextMinimap, minimap)) {
        minimap = nextMinimap;
        rebuildWorld();
    }
};

const scheduleRefresh = (): void => {
    if (editTimer !== null) clearTimeout(editTimer);
    editTimer = setTimeout(() => {
        editTimer = null;
        refreshQuietly();
    }, EDIT_SETTLE_MS);
};

const removeFloating = async (domId: string): Promise<void> => {
    try {
        unwrap(
            await issue({
                type: "command:dom:remove-floating-element",
                ...stamp(),
                req: { domId },
            })
        );
    } catch (err) {
        console.error(`${LOG} removing ${domId} failed`, err);
    }
};

const spriteSchema = (url: string, size: number): DomElementSchema => ({
    type: "box",
    styles: {
        width: [size, "px"],
        height: [size, "px"],
        pointerEvents: "none",
    },
    children: [
        {
            type: "image",
            child: url,
            styles: {
                width: [size, "px"],
                height: [size, "px"],
                pointerEvents: "none",
            },
        },
    ],
});

const warmUp = async (): Promise<void> => {
    const ids = ALL_SPRITES.map((_, i) => `${driverId}:warm:${i}`);
    await Promise.all(
        ALL_SPRITES.map(async (url, i) =>
            unwrap(
                await issue({
                    type: "command:dom:create-floating-element",
                    ...stamp(),
                    req: {
                        domId: ids[i],
                        position: WARMUP_POSITION,
                        schema: spriteSchema(url, WARMUP_SIZE),
                        asPopover: false,
                    },
                })
            )
        )
    );
    await new Promise<void>((resolve) => setTimeout(resolve, WARMUP_MS));
    for (const id of ids) void removeFloating(id);
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// Scaling about the bottom centre keeps the feet planted while Diny squashes or pops.
const petTransform = (pet: PetState): string =>
    `translateY(${PET_H / 2}px) scaleX(${pet.facing}) scale(${round3(pet.sx)}, ${round3(pet.sy)}) translateY(-${PET_H / 2}px)`;

const petSchema = (frame: Frame, transform: string): DomElementSchema => ({
    type: "box",
    styles: {
        width: [PET_W, "px"],
        height: [PET_H, "px"],
        overflow: "visible",
        pointerEvents: "auto",
        cursor: frame === "held" ? "grabbing" : "grab",
    },
    children: [
        {
            type: "image",
            child: PET_SPRITES[frame],
            styles: {
                width: [PET_W, "px"],
                height: [PET_H, "px"],
                pointerEvents: "none",
                transform,
            },
        },
    ],
});

const sendPet = async (
    active: Live,
    position: Point,
    schema: DomElementSchema
): Promise<void> => {
    const domId = petId();
    try {
        if (active.created) {
            unwrap(
                await issue({
                    type: "command:dom:update-floating-element",
                    ...stamp(),
                    req: { domId, position, schema },
                })
            );
        } else {
            unwrap(
                await issue({
                    type: "command:dom:upsert-floating-element",
                    ...stamp(),
                    req: { domId, position, schema, asPopover: false },
                })
            );
            active.created = true;
        }
    } catch (err) {
        active.created = false;
        throw err;
    } finally {
        if (live !== active) void removeFloating(domId);
    }
};

const render = (active: Live): void => {
    const { pet } = active;
    const position = {
        x: Math.round(pet.x - PET_W / 2),
        y: Math.round(pet.y - PET_H),
    };
    const transform = petTransform(pet);
    const key = `${position.x},${position.y},${pet.frame},${transform}`;
    if (active.inFlight || key === active.sent) return;
    active.inFlight = true;
    active.sent = key;
    void sendPet(active, position, petSchema(pet.frame, transform))
        .catch(() => {
            active.sent = "";
        })
        .finally(() => {
            active.inFlight = false;
        });
};

const frame = (active: Live): void => {
    if (live !== active) return;
    active.pet = stepPet(active.pet, Date.now(), world, Math.random);
    render(active);
};

const followCamera = (zoom: number): void => {
    followZoom = zoom;
    if (following) return;
    following = true;
    void (async () => {
        while (followZoom !== null) {
            const next = followZoom;
            followZoom = null;
            mapping = await readCamera(next);
            rebuildWorld();
            if (live) frame(live);
        }
    })()
        .catch(() => undefined)
        .finally(() => {
            following = false;
        });
};

const watchBoard = async (): Promise<void> => {
    if (watching) return;
    watching = true;
    unwrap(
        await issue({ type: "subscription:camera:moved-rapid", ...stamp() })
    );
    unwrap(
        await issue({
            type: "subscription:camera:moved-debounced",
            ...stamp(),
        })
    );
    unwrap(
        await issue({ type: "subscription:dom:screen-resized", ...stamp() })
    );
    for (const type of [
        "subscription:scene:elements-added",
        "subscription:scene:elements-updated",
        "subscription:scene:elements-removed",
        "subscription:scene:elements-replaced",
    ] as const) {
        try {
            unwrap(await issue({ type, ...stamp(), req: { properties: [] } }));
        } catch {
            // Without the scene permission there are no shapes to watch.
        }
    }
};

const start = async (): Promise<void> => {
    const gen = ++generation;
    await watchBoard();
    await refreshWorld();
    await warmUp();
    if (gen !== generation) return;
    const active: Live = {
        pet: spawnPet(Date.now(), world, Math.random),
        tick: null,
        poll: null,
        sent: "",
        inFlight: false,
        created: false,
    };
    live = active;
    active.tick = setInterval(() => frame(active), TICK_MS);
    active.poll = setInterval(() => {
        void checkBoard(active).catch(() => undefined);
    }, BOARD_POLL_MS);
    render(active);
    console.info(`${LOG} Diny is out`);
};

const stop = async (): Promise<void> => {
    generation++;
    const active = live;
    live = null;
    if (active?.tick) clearInterval(active.tick);
    if (active?.poll) clearInterval(active.poll);
    if (editTimer !== null) clearTimeout(editTimer);
    editTimer = null;
    await removeFloating(petId());
    console.info(`${LOG} Diny is away`);
};

const remember = async (on: boolean): Promise<void> => {
    try {
        unwrap(
            await issue({
                type: "command:kv-storage:set",
                ...stamp(),
                req: {
                    key: SETTINGS_KEY,
                    payload: { [SETTINGS_KEY]: { enabled: on } },
                },
            })
        );
    } catch (err) {
        console.error(`${LOG} saving the toggle failed`, err);
    }
};

const recalled = async (): Promise<boolean> => {
    const { got } = unwrap(
        await issue({
            type: "command:kv-storage:get",
            ...stamp(),
            req: { key: SETTINGS_KEY },
        })
    );
    const settings = got?.[SETTINGS_KEY] as { enabled?: unknown } | undefined;
    return settings?.enabled === true;
};

const begin = (): Promise<void> =>
    start().catch((err) => {
        enabled = false;
        console.error(`${LOG} start failed`, err);
    });

const toggle = async (): Promise<void> => {
    enabled = !enabled;
    void remember(enabled);
    if (enabled) await begin();
    else await stop();
};

const installButton = async (attempt: number): Promise<void> => {
    let created = false;
    try {
        created = unwrap(
            await issue({
                type: "command:dom:create-action-button",
                ...stamp(),
                req: { domElementId: buttonId(), svg: ACTION_BUTTON_SVG },
            })
        ).created;
        if (created) {
            unwrap(
                await issue({
                    type: "subscription:dom:element-clicked",
                    ...stamp(),
                    req: { domElementId: buttonId() },
                })
            );
            console.info(`${LOG} action button ready`);
            return;
        }
    } catch (err) {
        console.error(`${LOG} button attempt ${attempt} failed`, err);
    }
    if (attempt >= BUTTON_RETRIES_MS.length) {
        console.error(`${LOG} action button never created`);
        return;
    }
    setTimeout(() => {
        void installButton(attempt + 1);
    }, BUTTON_RETRIES_MS[attempt]);
};

// Timers left by an earlier activation see live change and stop on their own.
const reset = (): void => {
    generation++;
    live = null;
    editTimer = null;
    enabled = false;
    watching = false;
    elements = [];
    minimap = null;
    refreshing = false;
    refreshDirty = false;
    following = false;
    followZoom = null;
    drag = null;
    clickIgnoredUntil = 0;
};

const onDrag = (
    type: "dragStart" | "dragging" | "dragEnd",
    at: Point
): void => {
    if (!live) return;
    if (type === "dragStart") {
        drag = { from: at, lifted: false };
        return;
    }
    if (!drag) return;
    if (!drag.lifted) {
        if (Math.hypot(at.x - drag.from.x, at.y - drag.from.y) < PICKUP_PX) {
            if (type === "dragEnd") drag = null;
            return;
        }
        live.pet = pickUpPet(live.pet, Date.now(), drag.from);
        drag.lifted = true;
    }
    live.pet = carryPet(live.pet, at, world);
    if (type === "dragEnd") {
        live.pet = dropPet(live.pet, Date.now(), world);
        // The release over Diny also arrives as a click, which must not shout.
        clickIgnoredUntil = Date.now() + CLICK_AFTER_DROP_MS;
        drag = null;
    }
    render(live);
};

export const activate: DriverModule["activate"] = async (ctx) => {
    issue = ctx.issueCommand;
    driverId = ctx.manifest.driverId;
    reset();

    try {
        unwrap(
            await issue({
                type: "subscription:dom:element-clicked",
                ...stamp(),
                req: { domElementId: petId() },
            })
        );
        unwrap(
            await issue({
                type: "subscription:dom:drag",
                ...stamp(),
                req: { domElementId: petId() },
            })
        );
        await installButton(0);
        if (await recalled().catch(() => false)) {
            enabled = true;
            void begin();
        }
    } catch (err) {
        console.error(`${LOG} activation failed`, err);
    }
    console.info(`${LOG} activated (${ctx.manifest.driverVersion})`);
};

export const onEvent: DriverModule["onEvent"] = async (event) => {
    try {
        switch (event.type) {
            case "subscription:dom:element-clicked": {
                if (event.body.domElementId === buttonId()) {
                    void toggle();
                } else if (event.body.domElementId === petId() && live) {
                    if (Date.now() < clickIgnoredUntil) {
                        clickIgnoredUntil = 0;
                        return;
                    }
                    live.pet = clickPet(live.pet, Date.now());
                    render(live);
                }
                return;
            }
            case "subscription:dom:drag": {
                if (event.body.domElementId === petId()) {
                    onDrag(event.body.type, event.body.position.domSpace);
                }
                return;
            }
            case "subscription:camera:moved-rapid": {
                if (live) followCamera(event.body.zoom);
                return;
            }
            case "subscription:camera:moved-debounced": {
                if (live) refreshQuietly();
                return;
            }
            case "subscription:dom:screen-resized": {
                if (live) refreshQuietly();
                return;
            }
            case "subscription:scene:elements-added":
            case "subscription:scene:elements-updated": {
                if (live) scheduleRefresh();
                return;
            }
            case "subscription:scene:elements-removed": {
                if (!live) return;
                // Forgetting removed shapes now lets Diny drop on the next tick instead of standing on air until the refresh.
                const gone = new Set(
                    event.body.drawdyElements.map((el) => el.id)
                );
                elements = elements.filter((el) => !gone.has(el.id));
                rebuildWorld();
                scheduleRefresh();
                return;
            }
            case "subscription:scene:elements-replaced": {
                if (!live) return;
                live.pet = spawnPet(Date.now(), world, Math.random);
                refreshQuietly();
                return;
            }
            default:
                return;
        }
    } catch (err) {
        console.error(`${LOG} onEvent failed`, err);
    }
};
