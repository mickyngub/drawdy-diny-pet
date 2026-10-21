import type { Frame } from "./pet";
import { DINY_IDLE, DINY_SHOUT } from "./sprite-data";

export const PET_SPRITES: Record<Frame, string> = {
    idle: DINY_IDLE,
    shout: DINY_SHOUT,
};

export const ALL_SPRITES = [DINY_IDLE, DINY_SHOUT];

// Drawdy shows this through <img>, where currentColor is black, so the art is the full-colour idle frame.
export const ACTION_BUTTON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><image href="${DINY_IDLE}" x="0" y="0" width="24" height="24"/></svg>`;
