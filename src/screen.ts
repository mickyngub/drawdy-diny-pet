export type Rect = { x: number; y: number; width: number; height: number };

export type Point = { x: number; y: number };

export type ScreenMapping = {
    cx: number;
    cy: number;
    sx: number;
    sy: number;
    zoom: number;
};

export const toScreen = (m: ScreenMapping, p: Point): Point => ({
    x: m.sx + (p.x - m.cx) * m.zoom,
    y: m.sy + (p.y - m.cy) * m.zoom,
});

export const rectToScreen = (m: ScreenMapping, r: Rect): Rect => {
    const { x, y } = toScreen(m, r);
    return { x, y, width: r.width * m.zoom, height: r.height * m.zoom };
};
