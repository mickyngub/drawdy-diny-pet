import assert from "node:assert/strict";
import { test } from "node:test";
import * as art from "../src/sprite-data";
import { PET_SPRITES } from "../src/sprites";

test("Diny wears every frame from the art, each frame its own picture", () => {
    const worn = Object.values(PET_SPRITES);
    for (const [name, picture] of Object.entries(art)) {
        assert.ok(worn.includes(picture), `${name} is never shown`);
    }
    assert.equal(new Set(worn).size, worn.length);
});
