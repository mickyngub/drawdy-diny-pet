import type { Frame } from "./pet";
import {
    DINY_FALL,
    DINY_HELD,
    DINY_IDLE,
    DINY_JUMP,
    DINY_SHOUT,
    DINY_SLEEP,
    DINY_TIRED,
    DINY_WAVE,
} from "./sprite-data";

export const PET_SPRITES: Record<Frame, string> = {
    idle: DINY_IDLE,
    gape: DINY_SHOUT,
    wave: DINY_WAVE,
    jump: DINY_JUMP,
    fall: DINY_FALL,
    shout: DINY_SHOUT,
    tired: DINY_TIRED,
    sleep: DINY_SLEEP,
    held: DINY_HELD,
};

export const ALL_SPRITES = [...new Set(Object.values(PET_SPRITES))];

// Drawdy shows this through <img>, where currentColor is black, so the art is the full-colour idle frame.
export const ACTION_BUTTON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><image href="data:image/webp;base64,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" x="0" y="0" width="24" height="24"/></svg>`;
