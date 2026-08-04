/**
 * [snp] Tonight's sign-ups from sipnplay.cafe.
 *
 * Shared by two features that both need the same list: the "Name yourself" suggestions,
 * and the end-of-game report, which has to turn a typed name back into the customer id
 * that makes the leaderboard credit the right person.
 *
 * Fetched once and cached. Both callers get the same promise, so opening the page does
 * not hit the website twice.
 *
 * Everything here is best-effort. If the site is unreachable the list is simply empty:
 * names stop being suggested and players report as walk-ins, which is exactly what
 * would happen without the integration at all.
 */

/** name (lowercased, trimmed) -> customerId */
const byName = new Map();

let request = null;

/**
 * The night being run. Defaults to today, decided server-side in cafe local time, and
 * overridden by ?date=YYYY-MM-DD for a night that is not today.
 *
 * @return {String} The date, or "" to let the server decide.
 */
export function requestedDate() {

    const date = new URLSearchParams(window.location.search).get("date");

    return /^\d{4}-\d{2}-\d{2}$/.test(date || "")
        ? date
        : "";

}

/**
 * Loads the sign-ups, once.
 *
 * @return {Promise<Object>} Resolves to { players, date } — never rejects.
 */
export function loadTonight() {

    if (request) {
        return request;
    }

    const date = requestedDate();
    const query = date
        ? `?date=${encodeURIComponent(date)}`
        : "";

    request = fetch(`/snp/tonight${query}`, { headers: { Accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {

            const players = (data && Array.isArray(data.players))
                ? data.players
                : [];

            players.forEach(({ name, customerId }) => {

                if (name && customerId) {
                    byName.set(String(name).trim().toLowerCase(), customerId);
                }

            });

            return {
                players,
                date: (data && data.date) || date
            };

        })
        .catch(() => ({ players: [], date }));

    return request;

}

/**
 * The customer id for a typed player name, if they signed up.
 *
 * Matched case-insensitively on the whole name, because that is what the datalist put
 * in the box. Anything else is treated as a walk-in rather than guessed at — crediting
 * a game to the wrong person is worse than crediting it to nobody.
 *
 * @param  {String} name Player name as typed.
 * @return {String|null} Customer id, or null for a walk-in.
 */
export function customerIdFor(name) {

    if (!name) {
        return null;
    }

    return byName.get(String(name).trim().toLowerCase()) || null;

}
