import Store from "../../classes/Store.js";
import Observer from "../../classes/Observer.js";
import Template from "../../classes/Template.js";
import CharacterToken from "../../classes/CharacterToken.js";
import ReminderToken from "../../classes/ReminderToken.js";
import TokenStore from "../../classes/TokenStore.js";
import Dialog from "../../classes/Dialog.js";
import Names from "../../classes/Names.js";
import {
    loadTonight
} from "../../snp/tonight.js";
import {
    fetchFromStore
} from "../../utils/fetch.js";
import {
    lookup,
    lookupOne,
    lookupOneCached
} from "../../utils/elements.js";
import {
    LANGUAGE
} from "../../constants/language.js";

const store = Store.create("pocket-grimoire");
const gameObserver = Observer.create("game");

fetchFromStore(`characters_${LANGUAGE}`, URLS.characters, store).then((characters) => {
    gameObserver.trigger("characters-loaded", { characters });
});

fetchFromStore(`jinxes_${LANGUAGE}`, URLS.jinxes, store).then((jinxes) => {
    gameObserver.trigger("jinxes-loaded", { jinxes });
});

fetchFromStore("game", URLS.game, store).then((breakdown) => {
    gameObserver.trigger("team-breakdown-loaded", { breakdown });
});

CharacterToken.setTemplates({
    token: Template.create(lookupOne("#character-template")),
    list: Template.create(lookupOne("#character-list-template")),
    select: Template.create(lookupOne("#character-select-template")),
    nightOrder: Template.create(lookupOne("#night-info-template"))
});
ReminderToken.setTemplates({
    token: Template.create(lookupOne("#reminder-template")),
    list: Template.create(lookupOne("#reminder-list-template"))
});
Names.create()
    .setTemplate(Template.create(lookupOne("#player-name-template")))
    .setObserver(new Observer());

// [snp] Offer tonight's sign-ups in the "Name yourself" box.
//
// Suggestions, not a restriction: the input stays free text so walk-ins still work,
// which matters because plenty of players at the cafe never sign up online.
//
// Rendered as visible chips as well as feeding the <datalist>. The datalist alone was
// not enough: it stays invisible until you type and is unreliable on mobile, so on a
// phone going round a table the names were there but nobody could find them.
//
// The list is shared with the end-of-game report (see snp/tonight.js), which needs the
// same names to work out which players have accounts.
loadTonight().then(({ players }) => {

    const names = Names.create();
    players.forEach(({ name }) => names.add(name));

    const wrapper = lookupOne("#snp-signups");
    const list = lookupOne("#snp-signups-list");
    const walkin = lookupOne("#snp-walkin");
    // Upstream's field: select-your-character.js reads its .value when the dialog
    // closes. Whichever control is in use writes here.
    const hidden = lookupOne("#player-name");

    if (!walkin || !hidden) {
        return;
    }

    const chips = [];
    let picked = null;

    const paint = () => {

        chips.forEach((chip) => {

            const isPicked = chip.dataset.name === picked;
            chip.setAttribute("aria-pressed", isPicked ? "true" : "false");
            chip.style.outline = isPicked ? "3px solid #2b6cb0" : "";
            chip.style.fontWeight = isPicked ? "700" : "";
            // Greyed once a name has been typed instead — not disabled, so tapping one
            // is still how you change your mind.
            chip.style.opacity = (!picked && walkin.value.trim()) ? ".4" : "1";

        });

        const lockWalkin = picked !== null;
        walkin.disabled = lockWalkin;
        walkin.style.opacity = lockWalkin ? ".4" : "1";
        if (lockWalkin) {
            walkin.value = "";
        }

        // Only a name picked from the sign-up list reaches the leaderboard. A typed one
        // still labels the token on the board — it just is not an identity.
        hidden.value = picked || walkin.value.trim();

    };

    players.forEach(({ name }) => {

        const chip = document.createElement("button");
        chip.type = "button";
        chip.textContent = name;
        chip.className = "button";
        chip.dataset.name = name;
        // Narrower than the app's default button, which is built full-width and would
        // push three names off a phone screen.
        chip.style.cssText = "padding:.3rem .7rem;font-size:.85rem;width:auto";

        chip.addEventListener("click", () => {
            // Tapping the picked name again clears it, so a mis-tap is recoverable
            // without hunting for a reset.
            picked = (picked === name) ? null : name;
            paint();
        });

        chips.push(chip);
        list.appendChild(chip);

    });

    if (players.length > 0 && wrapper) {
        wrapper.hidden = false;
    }

    walkin.addEventListener("input", paint);

    // The dialog is reused for every player, and upstream only resets its own field, so
    // without this the next person inherits the last one's choice.
    const dialog = lookupOne("#character-decision");
    if (dialog) {
        dialog.addEventListener("close", () => {
            picked = null;
            walkin.value = "";
            paint();
        });
    }

    paint();

});

Promise.all([
    new Promise((resolve) => {
        gameObserver.on("characters-loaded", ({ detail }) => {
            resolve(detail.characters);
        });
    }),
    new Promise((resolve) => {
        gameObserver.on("jinxes-loaded", ({ detail }) => {
            resolve(detail.jinxes);
        });
    })
]).then(([ characters, jinxes ]) => {

    TokenStore.create({
        characters: [
            // Create an empty character which we can use as a token placeholder.
            {
                id: TokenStore.EMPTY,
                image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
                ability: I18N.emptyCharacterAbility,
                [CharacterToken.empty]: true,
            },
            ...characters
        ],
        reminders: [
            {
                id: TokenStore.EMPTY,
                name: "",
                text: I18N.goodTeam,
                image: "/build/img/icons/townsfolk.webp",
                isGlobal: true
            },
            {
                id: TokenStore.EMPTY,
                name: "",
                text: I18N.evilTeam,
                image: "/build/img/icons/demon.webp",
                isGlobal: true
            }
        ],
        jinxes
    });

});

// Delegate this event for two reasons:
// 1. We can add dialogs dynamically and they'll still work.
// 2. It's more efficient to only create the instance when it's needed.
document.body.addEventListener("click", ({ target }) => {

    if (target.hasAttribute("data-dialog") && !target.dialog) {

        target.dialog = Dialog.createFromTrigger(target);
        target.dialog.show();

    }

});

lookup("input[data-filter-list]").forEach((input) => {

    input.addEventListener("change", ({ target }) => {

        const list = lookupOneCached(target.dataset.filterList);

        if (!list) {
            return;
        }

        list.classList.toggle("is-show-all", target.checked);

    });

});

lookupOne("#locale-form").addEventListener("submit", (e) => {
    e.preventDefault();
    window.location.href = lookupOneCached("#select-locale").value;
});

lookupOneCached("#select-locale").addEventListener("change", ({ target }) => {
    target.form.requestSubmit();
});

function setTrackWidth(input) {

    const {
        min,
        max,
        value
    } = input;

    input.style.setProperty(
        "--size",
        ((value - min) * 100) / (max - min)
    );

}

const rangeObserver = new MutationObserver((entries) => {

    entries.forEach(({ type, target }) => {

        if (type == "attributes") {
            setTrackWidth(target);
        }

    });

});

lookup("input[type=\"range\"][data-output]").forEach((input) => {

    const output = lookupOne(input.dataset.output);

    input.addEventListener("input", () => {

        setTrackWidth(input);

        if (output) {
            output.value = input.value
        }

    });

    setTrackWidth(input);
    rangeObserver.observe(input, {
        attributes: true,
        attributeFilter: ["min", "max", "value"]
    });

});
