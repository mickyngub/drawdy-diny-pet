import type { Frame } from "./pet";
import {
    DINY_FALL,
    DINY_HAPPY,
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
    happy: DINY_HAPPY,
    wave: DINY_WAVE,
    jump: DINY_JUMP,
    fall: DINY_FALL,
    shout: DINY_SHOUT,
    tired: DINY_TIRED,
    sleep: DINY_SLEEP,
    held: DINY_HELD,
};

export const ALL_SPRITES = Object.values(PET_SPRITES);

// Drawdy shows this through <img>, where currentColor is black, so the art is the full-colour idle frame.
export const ACTION_BUTTON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><image href="data:image/webp;base64,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" x="0" y="0" width="24" height="24"/></svg>`;
