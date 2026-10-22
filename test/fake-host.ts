import type {
    DomElementSchema,
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
} from "@drawdy/driver-protocol";

export type Rect = { x: number; y: number; width: number; height: number };

export type Stored = Record<string, unknown> & {
    drawdyElementId: string;
    type: string;
};

export type Camera = { x: number; y: number; zoom: number };

export type Floating = {
    position: { x: number; y: number };
    schema: DomElementSchema;
    asPopover?: boolean;
};

type Options = {
    viewport?: Rect;
    windowSize?: { width: number; height: number };
    canvas?: Rect;
    // Page elements by id, such as the board frame and the minimap.
    domRects?: Record<string, Rect>;
    camera?: Camera;
    tool?: string | null;
    denied?: string[];
    full?: boolean;
    failAdd?: boolean;
    kv?: Record<string, unknown>;
};

type Sent = { type: string; req?: any };

/** Element rect as the host reports it; elements without x/y/width/height need one passed in. */
export type RectOf = (el: Stored) => Rect;

export const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;

/** Points as the host reports them: pairs, whatever shape the element was added with. */
export function pointsOf(el: Stored): [number, number][] {
    if (Array.isArray(el.from) && Array.isArray(el.to)) {
        return [el.from as [number, number], el.to as [number, number]];
    }
    if (Array.isArray(el.points)) {
        const flat = el.points as number[];
        const pairs: [number, number][] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
            pairs.push([flat[i], flat[i + 1]]);
        }
        return pairs;
    }
    return [[el.x as number, el.y as number]];
}

const plainRect: RectOf = (el) => {
    if (typeof el.x === "number" && typeof el.y === "number") {
        return {
            x: el.x,
            y: el.y,
            width: (el.width as number | undefined) ?? 0,
            height: (el.height as number | undefined) ?? 0,
        };
    }
    const points = pointsOf(el);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export function fakeHost(options: Options = {}, rectOf: RectOf = plainRect) {
    const windowSize = options.windowSize ?? { width: 1600, height: 1000 };
    let camera: Camera = options.camera ?? { x: 0, y: 0, zoom: 1 };
    // The canvas fills the window unless a sidebar squeezes it; the viewport is the canvas seen through the camera.
    let canvas: Rect = options.canvas ?? { x: 0, y: 0, ...windowSize };
    const domRects = new Map(Object.entries(options.domRects ?? {}));
    const viewport = (): Rect =>
        options.viewport ?? {
            x: camera.x,
            y: camera.y,
            width: canvas.width / camera.zoom,
            height: canvas.height / camera.zoom,
        };
    const held = new Map<string, (() => void)[]>();
    const sent: Sent[] = [];
    const posted: any[] = [];
    const kv: Record<string, unknown> = { ...options.kv };
    const floating = new Map<string, Floating>();
    const previews = new Map<string, Stored[]>();
    const subscriptions = new Map<string, { type: string; req?: any }>();
    let elements = new Map<string, Stored>();
    const undo: Map<string, Stored>[] = [];
    let selection: string[] = [];
    let tool: string | null =
        options.tool === undefined ? "pencil" : options.tool;
    let ids = 0;
    let previewIds = 0;
    let subscriptionIds = 0;

    const snapshot = () => undo.push(new Map(elements));

    const issueCommand = (async (cmd: any) => {
        sent.push({ type: cmd.type, req: cmd.req });
        const gate = held.get(cmd.type);
        if (gate) await new Promise<void>((resolve) => gate.push(resolve));
        const ok = (value?: unknown) => ({ ...cmd, res: { value } });
        const fail = (type: string) => ({ ...cmd, res: { error: { type } } });
        if (options.denied?.some((prefix) => cmd.type.startsWith(prefix))) {
            return fail("unauthorized");
        }
        if (cmd.type.startsWith("subscription:")) {
            const subscriptionId = `sub-${++subscriptionIds}`;
            subscriptions.set(subscriptionId, {
                type: cmd.type,
                req: cmd.req,
            });
            return ok({ subscriptionId });
        }
        switch (cmd.type) {
            case "command:subscription:remove":
                return ok({
                    removed: subscriptions.delete(cmd.req.subscriptionId),
                });
            case "command:webview:post-message":
                posted.push(cmd.req.message);
                return ok();
            case "command:camera:get-viewport-rect":
                return ok({ rect: viewport() });
            case "command:camera:get-info":
                return ok({ ...camera });
            case "command:camera:canvas-to-screen":
                return ok({
                    x: canvas.x + (cmd.req.x - camera.x) * camera.zoom,
                    y: canvas.y + (cmd.req.y - camera.y) * camera.zoom,
                });
            case "command:camera:screen-to-canvas":
                return ok({
                    x: (cmd.req.x - canvas.x) / camera.zoom + camera.x,
                    y: (cmd.req.y - canvas.y) / camera.zoom + camera.y,
                });
            case "command:dom:element-rect": {
                const rect = domRects.get(cmd.req.elementId);
                return rect ? ok(rect) : fail("not-found");
            }
            case "command:dom:window-size":
                return ok(windowSize);
            case "command:dom:create-action-button":
                return ok({ created: true });
            case "command:dom:create-floating-element": {
                if (floating.has(cmd.req.domId)) return ok({ created: false });
                const { position, schema, asPopover } = cmd.req;
                floating.set(cmd.req.domId, { position, schema, asPopover });
                return ok({ created: true });
            }
            case "command:dom:upsert-floating-element": {
                const { position, schema, asPopover } = cmd.req;
                const existed = floating.has(cmd.req.domId);
                floating.set(cmd.req.domId, {
                    position,
                    schema,
                    asPopover: existed
                        ? floating.get(cmd.req.domId)?.asPopover
                        : asPopover,
                });
                return ok({ created: !existed });
            }
            case "command:dom:update-floating-element": {
                const current = floating.get(cmd.req.domId);
                if (!current) return fail("not-found");
                floating.set(cmd.req.domId, {
                    ...current,
                    position: cmd.req.position,
                    schema: cmd.req.schema,
                });
                return ok();
            }
            case "command:dom:move-floating-element": {
                const current = floating.get(cmd.req.domId);
                if (!current) return fail("not-found");
                floating.set(cmd.req.domId, {
                    ...current,
                    position: cmd.req.position,
                });
                return ok();
            }
            case "command:dom:remove-floating-element":
                return ok({ removed: floating.delete(cmd.req.domId) });
            case "command:tools:get-active":
                return ok({ toolId: tool });
            case "command:kv-storage:get":
                return ok({ got: { [cmd.req.key]: kv[cmd.req.key] } });
            case "command:kv-storage:set":
                Object.assign(kv, cmd.req.payload);
                return ok();
            case "command:scene:create-drawdy-preview-elements": {
                const previewId = `preview-${++previewIds}`;
                previews.set(previewId, cmd.req.elements as Stored[]);
                return ok({ previewId, previewed: cmd.req.elements.length });
            }
            case "command:scene:delete-drawdy-preview-elements": {
                let deleted = 0;
                for (const id of cmd.req.previewIds as string[]) {
                    if (previews.delete(id)) deleted++;
                }
                return ok({ deleted });
            }
            case "command:scene:query-rect":
                return ok({
                    drawdyElements: [...elements.values()]
                        .filter((el) => overlaps(rectOf(el), cmd.req.rect))
                        .map((el) => ({
                            id: el.drawdyElementId,
                            type: el.type,
                        })),
                });
            case "command:scene:element-rects":
                return ok({
                    rects: (cmd.req.drawdyElementIds as string[]).flatMap(
                        (id) => {
                            const el = elements.get(id);
                            return el
                                ? [{ drawdyElementId: id, rect: rectOf(el) }]
                                : [];
                        }
                    ),
                });
            case "command:scene:add-drawdy-elements":
                if (options.failAdd) return fail("bad-argument");
                snapshot();
                if (!options.full) {
                    for (const el of cmd.req.elements as Stored[]) {
                        elements.set(el.drawdyElementId, { ...el });
                    }
                }
                return ok();
            case "command:scene:remove-drawdy-elements": {
                snapshot();
                let removed = 0;
                for (const id of cmd.req.drawdyElementIds as string[]) {
                    if (elements.delete(id)) removed++;
                }
                return ok({ removed });
            }
            case "command:scene:update-drawdy-elements": {
                snapshot();
                for (const { drawdyElementId, properties } of cmd.req.updates) {
                    const el = elements.get(drawdyElementId);
                    if (el)
                        elements.set(drawdyElementId, { ...el, ...properties });
                }
                return ok({ updated: cmd.req.updates.length });
            }
            case "command:scene:get-drawdy-elements":
                return ok({
                    drawdyElements: (
                        (cmd.req.drawdyElementIds as string[] | undefined) ?? [
                            ...elements.keys(),
                        ]
                    )
                        .map((id) => elements.get(id))
                        .filter((el): el is Stored => el !== undefined)
                        .map((el) => {
                            const picked: Record<string, unknown> = {
                                id: el.drawdyElementId,
                            };
                            for (const key of cmd.req.properties) {
                                if (key === "points")
                                    picked.points = pointsOf(el);
                                else if (key in el) picked[key] = el[key];
                            }
                            return picked;
                        }),
                });
            case "command:scene:get-current-selected-drawdy-elements":
                return ok({ drawdyElementIds: selection });
            case "command:scene:set-selection":
                selection = cmd.req.drawdyElementIds;
                return ok();
            case "command:history:undo": {
                const previous = undo.pop();
                if (previous) elements = previous;
                return ok();
            }
            default:
                return ok({});
        }
    }) as unknown as DriverCommandIssuer;

    return {
        issueCommand,
        sent,
        posted,
        kv,
        floating,
        subscriptions,
        get elements() {
            return elements;
        },
        get previews() {
            return [...previews.values()].flat();
        },
        setTool(next: string | null) {
            tool = next;
        },
        moveCamera(next: Camera) {
            camera = next;
        },
        /** Moves or resizes the canvas, as opening the sidebar does, with no event. */
        moveCanvas(next: Rect) {
            canvas = next;
        },
        /** Moves a page element, or takes it off the page with null, with no event. */
        setDomRect(id: string, rect: Rect | null) {
            if (rect) domRects.set(id, rect);
            else domRects.delete(id);
        },
        /** Holds every command of this type unanswered until the returned release is called. */
        hold(type: string) {
            held.set(type, []);
            return () => {
                const waiting = held.get(type) ?? [];
                held.delete(type);
                for (const resolve of waiting) resolve();
            };
        },
        remove(id: string) {
            elements.delete(id);
        },
        select(next: string[]) {
            selection = next;
        },
        put(el: Stored) {
            elements.set(el.drawdyElementId, el);
        },
        subscribedTo(type: string) {
            return [...subscriptions.values()].some((s) => s.type === type);
        },
        nextId: () => `el-${++ids}`,
        types: () => sent.map((s) => s.type),
        clear() {
            sent.length = 0;
            posted.length = 0;
        },
    };
}

export type FakeHost = ReturnType<typeof fakeHost>;

/** Every node in a floating element's schema, the root included. */
export function schemaNodes(schema: DomElementSchema): DomElementSchema[] {
    const children = "children" in schema ? (schema.children ?? []) : [];
    return [schema, ...children.flatMap(schemaNodes)];
}

export async function boot(
    module: DriverModule,
    host: FakeHost,
    manifest: DriverManifest
) {
    await module.activate({
        manifest,
        issueCommand: host.issueCommand,
        styling: { theme: "light" } as any,
        generateId: host.nextId,
    });
    const message = (body: Record<string, unknown>) =>
        module.onEvent({
            type: "subscription:webview:message",
            body: {
                webviewDomId: `${manifest.driverId}:webview`,
                message: body,
            },
        } as any);
    // Delivers an event only through a live subscription, as the host does; resolves false when none matches.
    const emit = async (
        type: string,
        body: Record<string, unknown>
    ): Promise<boolean> => {
        const match = [...host.subscriptions.entries()].find(
            ([, s]) =>
                s.type === type &&
                (s.req?.domElementId === undefined ||
                    s.req.domElementId === body.domElementId)
        );
        if (!match) return false;
        await module.onEvent({ type, subscriptionId: match[0], body } as any);
        return true;
    };
    return { message, emit };
}
