import type { SubscribedDrawdyElement } from "@drawdy/driver-protocol";
import type { Platform } from "./pet";
import { rectToScreen, type ScreenMapping } from "./screen";

const MAX_TILT = 0.05;

export function platformsFrom(
    elements: readonly SubscribedDrawdyElement[],
    camera: ScreenMapping,
    minWidthPx: number
): Platform[] {
    return elements.flatMap((el) => {
        const { type, x, y, width, height, rotation = 0 } = el;
        if (
            type === "frame" ||
            x === undefined ||
            y === undefined ||
            width === undefined ||
            height === undefined ||
            Math.abs(rotation) >= MAX_TILT
        ) {
            return [];
        }
        const rect = rectToScreen(camera, { x, y, width, height });
        if (rect.width < minWidthPx) return [];
        return [
            {
                id: el.id,
                left: rect.x,
                right: rect.x + rect.width,
                top: rect.y,
            },
        ];
    });
}
