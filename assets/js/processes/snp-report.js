import { capturePad } from "../snp/snapshot.js";
/**
 * [snp] End of game — report the result to the Sip n Play leaderboard.
 *
 * Removes the retype-it-afterwards step: whatever is on the grimoire when the game ends
 * IS the record. Upstream has no notion of a game finishing, so all of this is ours.
 *
 * The preview matters. It shows exactly who is about to be written and how they will be
 * credited, because a wrong seat is trivial to fix before the write and annoying after.
 */

import {
    lookupOne,
    lookupOneCached
} from "../utils/elements.js";
import {
    loadTonight,
    customerIdFor,
    requestedDate
} from "../snp/tonight.js";

const wrapper = lookupOne("#snp-report-body");

// The section only exists on the grimoire page; bail out quietly anywhere else.
if (wrapper) {

    const preview = lookupOne("#snp-report-preview");
    const status = lookupOne("#snp-report-status");
    const button = lookupOne("#snp-report-send");
    const dateInput = lookupOne("#snp-report-date");
    const details = lookupOne("#snp-report");

    let sending = false;
    let capturing = false;
    let snapshot = null;
    let snapshotState = "";
    const picture = lookupOne("#snp-report-picture");
    const pictureStatus = lookupOne("#snp-report-picture-status");
    const refresh = lookupOne("#snp-report-refresh");
    const omit = lookupOne("#snp-report-omit-picture");
    const boardState = () => {
        const pad = lookupOneCached(".js--pad");
        return JSON.stringify([pad.innerHTML, pad.offsetWidth, pad.offsetHeight, document.documentElement.getAttribute("style"), document.body.className, collectPlayers()]);
    };
    const updateButton = () => {
        button.disabled = sending || capturing || !collectPlayers().length ||
            !wrapper.querySelector("input[name=snp-winner]:checked") ||
            (!omit.checked && (!snapshot || snapshotState !== boardState()));
    };
    const invalidate = () => {
        if (snapshot && snapshotState !== boardState()) {
            snapshot = null;
            picture.hidden = true;
            picture.removeAttribute("src");
            pictureStatus.textContent = "The board changed. Refresh the picture before reporting.";
        }
        updateButton();
    };
    const capture = async () => {
        if (capturing || sending) return;
        capturing = true;
        snapshot = null;
        picture.hidden = true;
        refresh.disabled = true;
        pictureStatus.textContent = "Taking a picture of the final board…";
        updateButton();
        try {
            await loadTonight();
            // The pad lives in a collapsible section; hidden pads have no layout.
            const boardSection = lookupOneCached(".js--pad").closest("details");
            if (boardSection && !boardSection.open) {
                boardSection.open = true;
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
            const state = boardState();
            let timer;
            let image;
            try {
                image = await Promise.race([
                    capturePad(lookupOneCached(".js--pad")),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error("Picture timed out. Try again or report without a picture.")), 20000);
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
            if (state !== boardState()) throw new Error("The board changed. Refresh the picture again.");
            snapshot = image;
            snapshotState = state;
            picture.src = image;
            picture.hidden = omit.checked;
            pictureStatus.textContent = "Check the seats, characters, reminders and shrouds before reporting.";
        } catch (error) {
            pictureStatus.textContent = error.message || "Could not capture the board. Try again or report without a picture.";
        } finally {
            capturing = false;
            refresh.disabled = false;
            drawPreview();
        }
    };
    refresh.addEventListener("click", capture);
    omit.addEventListener("change", () => {
        picture.hidden = omit.checked || !snapshot;
        updateButton();
    });
    const padElement = lookupOneCached(".js--pad");
    if (padElement) {
        new MutationObserver(invalidate).observe(padElement, { subtree: true, childList: true, attributes: true, characterData: true });
        new ResizeObserver(invalidate).observe(padElement);
    }
    new MutationObserver(invalidate).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    new MutationObserver(invalidate).observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    const escapeText = (value) => {
        const span = document.createElement("span");
        span.textContent = value;
        return span.innerHTML;
    };

    const setStatus = (message, kind) => {
        status.textContent = message || "";
        status.dataset.kind = kind || "";
    };

    /**
     * Everyone currently on the grimoire, in the shape the report needs.
     *
     * Read straight off the pad rather than from any state we keep ourselves, so the
     * report cannot drift from what the storyteller is looking at.
     */
    const collectPlayers = () => {

        const padElement = lookupOneCached(".js--pad");
        const pad = padElement && padElement.pad;

        if (!pad) {
            return [];
        }

        return pad.characters
            .map(({ character }) => {

                const name = (pad.getPlayerName(character) || "").trim();

                return {
                    name,
                    customerId: customerIdFor(name),
                    characterId: character.getId(),
                    characterName: character.getName(),
                    characterTeam: character.getTeam()
                };

            })
            // A token with no character is an empty seat, not a player.
            .filter((player) => player.characterName);

    };

    const drawPreview = () => {

        const players = collectPlayers();

        if (players.length === 0) {
            preview.innerHTML = "<p class=\"text-small\">Nothing on the grimoire yet.</p>";
            button.disabled = true;
            return players;
        }

        const linked = players.filter((player) => player.customerId).length;
        const untracked = players.length - linked;

        const rows = players.map((player) => {

            const who = player.name
                ? escapeText(player.name)
                : "<em>no name</em>";
            // Says plainly how each seat will be credited. Only a name picked from the
            // sign-up list is an account; anything typed is a label on the board and is
            // deliberately not tracked, which is what the dialog promises.
            const credit = player.customerId
                ? "account"
                : "not tracked";

            return `<li>${who} — ${escapeText(player.characterName)} <span class="text-small">(${credit})</span></li>`;

        }).join("");

        preview.innerHTML = `
            <p class="text-small">
                Reporting ${players.length} player${players.length === 1 ? "" : "s"} —
                ${linked} on the leaderboard${untracked ? `, ${untracked} not tracked` : ""}.
            </p>
            <ul class="text-small">${rows}</ul>
        `;

        updateButton();

        return players;

    };

    const chosenDate = () => {

        const value = (dateInput.value || "").trim();

        return /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? value
            : "";

    };

    const send = () => {

        const winner = wrapper.querySelector("input[name=snp-winner]:checked");

        invalidate();
        if (!winner || sending || button.disabled) {
            return;
        }

        const players = collectPlayers();

        if (players.length === 0) {
            setStatus("There is nothing on the grimoire to report.", "error");
            return;
        }

        sending = true;
        button.disabled = true;
        setStatus("Reporting…", "");

        // The storyteller notes double as the game notes — there is no reason to ask
        // for the same thing twice.
        const notesField = lookupOneCached("#st-notes");

        fetch("/snp/report", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                grimoireImage: omit.checked ? null : snapshot,
                date: chosenDate(),
                winningTeam: winner.value,
                notes: notesField ? notesField.value : "",
                // A typed name is sent as no name at all. The seat still counts towards
                // the game — player numbers and character stays stay right — but it
                // creates no leaderboard identity, which is what "no leaderboard entry
                // tracked" promises the player, and is what stopped free-typed names
                // splitting people across two identities.
                players: players.map((player) => (
                    player.customerId
                        ? player
                        : { ...player, name: "" }
                ))
            })
        })
            .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {

                if (!ok || !data.ok) {
                    setStatus(data.error || "The game was not recorded.", "error");
                    return;
                }

                setStatus(
                    `Reported ${data.playerCount} players for ${data.date}. It is on the leaderboard.`,
                    "success"
                );

                // Clearing the winner stops a double tap sending the same game twice.
                const checked = wrapper.querySelector("input[name=snp-winner]:checked");
                if (checked) {
                    checked.checked = false;
                }

            })
            .catch(() => {
                setStatus("Could not reach the grimoire server. The game was NOT recorded.", "error");
            })
            .finally(() => {
                sending = false;
                drawPreview();
            });

    };

    wrapper.addEventListener("change", ({ target }) => {

        if (target.name === "snp-winner") {
            updateButton();
        }

    });

    button.addEventListener("click", send);

    // Refresh the preview whenever the section is opened, so it always reflects the
    // grimoire as it stands rather than as it was when the page loaded.
    if (details) {

        details.addEventListener("toggle", () => {

            if (details.open) {
                drawPreview();
                if (!omit.checked) capture();
            }

        });

    }

    // Default the date to the night being run, worked out server-side in cafe time.
    loadTonight().then(({ date }) => {

        dateInput.value = requestedDate() || date || "";
        drawPreview();

    });

}
