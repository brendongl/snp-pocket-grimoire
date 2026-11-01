import "regenerator-runtime/runtime";
import { toPng, getFontEmbedCSS } from "html-to-image";

/** Capture the whole scrollable pad at its existing layout, including reminders/shrouds. */
export async function capturePad(pad) {
    await document.fonts.ready;
    await Promise.all([...pad.querySelectorAll("img")].map((image) => image.decode()));
    const width = Math.max(pad.offsetWidth, pad.scrollWidth + 4);
    const height = Math.max(pad.offsetHeight, pad.scrollHeight + 4);
    if (!width || !height || width * height > 16000000) {
        throw new Error("The board is too large to capture. Resize it and try again.");
    }
    const image = await toPng(pad, {
        width,
        height,
        pixelRatio: Math.min(2, 2048 / Math.max(width, height)),
        backgroundColor: "#333333",
        // Computed pseudo-element margins lose `auto`; retain the two night
        // numbers on opposite sides rather than painting one over the other.
        fontEmbedCSS: (await getFontEmbedCSS(pad)) + `
            .character:not(.is-upside-down)[data-first-night]::before,
            .character.is-upside-down[data-other-night]::after {
                margin-left:2.5%!important; margin-right:auto!important;
            }
            .character:not(.is-upside-down)[data-other-night]::after,
            .character.is-upside-down[data-first-night]::before {
                margin-left:auto!important; margin-right:2.5%!important;
            }
        `,
        // Computed implicit grid tracks become explicit tracks when copied. The
        // tokens use column -1 to layer icons/shrouds; copying those tracks moves
        // every overlay one column to the right in the PNG.
        includeStyleProperties: [...getComputedStyle(document.documentElement)]
            .filter((name) => !name.startsWith("grid-template")),
        style: { overflow: "visible", resize: "none", maxWidth: "none", maxHeight: "none" },
    });
    if (image.length > Math.ceil(4 * 1024 * 1024 * 4 / 3) + 22) {
        throw new Error("The picture is too large. Resize the board and try again.");
    }
    return image;
}
