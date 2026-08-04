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
        const unnamed = players.filter((player) => !player.name).length;

        const rows = players.map((player) => {

            const who = player.name
                ? player.name
                : "<em>no name</em>";
            // Says plainly how each seat will be credited: to an account, to a typed
            // name on the leaderboard, or to nobody at all.
            const credit = player.customerId
                ? "account"
                : (player.name ? "walk-in" : "not credited");

            return `<li>${who} — ${player.characterName} <span class="text-small">(${credit})</span></li>`;

        }).join("");

        preview.innerHTML = `
            <p class="text-small">
                Reporting ${players.length} player${players.length === 1 ? "" : "s"} —
                ${linked} linked to an account${unnamed ? `, ${unnamed} with no name` : ""}.
            </p>
            <ul class="text-small">${rows}</ul>
        `;

        const winner = wrapper.querySelector("input[name=snp-winner]:checked");
        button.disabled = sending || !winner;

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

        if (!winner || sending) {
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
                date: chosenDate(),
                winningTeam: winner.value,
                notes: notesField ? notesField.value : "",
                players
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
            button.disabled = sending;
        }

    });

    button.addEventListener("click", send);

    // Refresh the preview whenever the section is opened, so it always reflects the
    // grimoire as it stands rather than as it was when the page loaded.
    if (details) {

        details.addEventListener("toggle", () => {

            if (details.open) {
                drawPreview();
            }

        });

    }

    // Default the date to the night being run, worked out server-side in cafe time.
    loadTonight().then(({ date }) => {

        dateInput.value = requestedDate() || date || "";
        drawPreview();

    });

}
