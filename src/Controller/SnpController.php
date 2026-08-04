<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * [snp] Sip n Play integration.
 *
 * Talks to the cafe's website (snp-site) so a storyteller can pick a player from that
 * night's actual sign-ups instead of typing a name, and so a finished game reports
 * itself to the leaderboard.
 *
 * This exists as a server-side proxy for one reason: the bridge API key must never
 * reach the browser. The grimoire has no login of its own and runs on a shared phone
 * passed around a table, so anything the page can read is effectively public. The key
 * stays in the container's environment and only this controller ever sees it.
 *
 * Everything here fails soft. The grimoire has to keep working when the website is
 * down, the key is wrong, or the box has no route to the internet — a storyteller
 * mid-game must never be blocked by our integration.
 */
class SnpController extends AbstractController
{

    private $http;
    private $bridgeUrl;
    private $bridgeKey;
    private $timezone;

    public function __construct(HttpClientInterface $http)
    {
        $this->http = $http;
        $this->bridgeUrl = rtrim((string) ($_ENV['SNP_BRIDGE_URL'] ?? ''), '/');
        $this->bridgeKey = (string) ($_ENV['SNP_BRIDGE_KEY'] ?? '');
        // Game nights are dated in cafe local time; the container runs UTC, and at 04:00
        // UTC it is already the next day in Saigon.
        $this->timezone = (string) ($_ENV['SNP_TIMEZONE'] ?? 'Asia/Ho_Chi_Minh');
    }

    private function isConfigured(): bool
    {
        return $this->bridgeUrl !== '' && $this->bridgeKey !== '';
    }

    private function today(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone($this->timezone)))
            ->format('Y-m-d');
    }

    /**
     * GET /snp/tonight[?date=YYYY-MM-DD]
     *
     * The players signed up for tonight's game, for the "Name yourself" picker.
     * Always 200 with a `players` array — an empty one when we cannot reach the site —
     * so the front end has exactly one shape to handle.
     *
     * @Route("/snp/tonight", name="snp_tonight", methods={"GET"})
     */
    public function tonight(Request $request): JsonResponse
    {
        $date = (string) $request->query->get('date', '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = $this->today();
        }

        if (!$this->isConfigured()) {
            return $this->json([
                'configured' => false,
                'date' => $date,
                'players' => [],
            ]);
        }

        try {
            $response = $this->http->request('GET', $this->bridgeUrl . '/api/botc/bridge/night', [
                'query' => ['date' => $date],
                'headers' => ['Authorization' => 'Bearer ' . $this->bridgeKey],
                'timeout' => 8,
            ]);

            if ($response->getStatusCode() !== 200) {
                return $this->json([
                    'configured' => true,
                    'date' => $date,
                    'players' => [],
                    'error' => 'site returned ' . $response->getStatusCode(),
                ]);
            }

            $data = $response->toArray(false);
            $players = [];
            foreach (($data['registrants'] ?? []) as $registrant) {
                $name = trim((string) ($registrant['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                $players[] = [
                    'name' => $name,
                    'customerId' => $registrant['customerId'] ?? null,
                ];
            }

            return $this->json([
                'configured' => true,
                'date' => $date,
                'players' => $players,
            ]);

        } catch (\Throwable $e) {
            // Deliberately swallowed: an unreachable website must not stop the grimoire.
            return $this->json([
                'configured' => true,
                'date' => $date,
                'players' => [],
                'error' => 'unreachable',
            ]);
        }
    }

    /**
     * POST /snp/report
     *
     * Send a finished game to the leaderboard.
     *
     * Body: { date?, winningTeam, notes?, players: [{ name, customerId?, characterId,
     *         characterName, characterTeam }] }
     *
     * Unlike /snp/tonight this does NOT fail silently. A storyteller pressing "Report
     * game" is asking for something to happen, and a green tick over a game that was
     * never recorded is worse than an error — they would find out weeks later when the
     * leaderboard was wrong.
     *
     * @Route("/snp/report", name="snp_report", methods={"POST"})
     */
    public function report(Request $request): JsonResponse
    {
        if (!$this->isConfigured()) {
            return $this->json([
                'ok' => false,
                'error' => 'The leaderboard bridge is not configured on this grimoire.',
            ], 503);
        }

        $body = json_decode($request->getContent(), true);
        if (!is_array($body)) {
            return $this->json(['ok' => false, 'error' => 'Malformed request.'], 400);
        }

        $winningTeam = (string) ($body['winningTeam'] ?? '');
        if (!in_array($winningTeam, ['good', 'evil', 'none'], true)) {
            return $this->json(['ok' => false, 'error' => 'Pick who won first.'], 400);
        }

        $date = (string) ($body['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = $this->today();
        }

        $players = [];
        foreach (($body['players'] ?? []) as $player) {
            $characterName = trim((string) ($player['characterName'] ?? ''));
            if ($characterName === '') {
                continue;
            }

            $team = (string) ($player['characterTeam'] ?? '');
            $customerId = $player['customerId'] ?? null;
            $name = trim((string) ($player['name'] ?? ''));

            $players[] = [
                // An account player carries customerId and no name, so the leaderboard
                // resolves their display name at read time and a later rename updates
                // their history. A walk-in carries the typed name. Never both.
                'customerId' => $customerId ?: null,
                'playerName' => $customerId ? null : ($name !== '' ? $name : null),
                'characterId' => $player['characterId'] ?? null,
                'characterName' => $characterName,
                'characterTeam' => $team !== '' ? $team : null,
                // Pocket Grimoire has no separate alignment - it is implied by team.
                'alignment' => in_array($team, ['minion', 'demon'], true) ? 'evil' : 'good',
            ];
        }

        if (count($players) === 0) {
            return $this->json([
                'ok' => false,
                'error' => 'No characters on the grimoire to report.',
            ], 400);
        }

        $payload = [
            'date' => $date,
            'winningTeam' => $winningTeam,
            'players' => $players,
        ];
        if (!empty($body['scriptName'])) {
            $payload['scriptName'] = (string) $body['scriptName'];
        }
        if (!empty($body['notes'])) {
            $payload['notes'] = (string) $body['notes'];
        }

        try {
            $response = $this->http->request('POST', $this->bridgeUrl . '/api/botc/bridge/games', [
                'headers' => [
                    'Authorization' => 'Bearer ' . $this->bridgeKey,
                    'Content-Type' => 'application/json',
                ],
                'body' => json_encode($payload),
                'timeout' => 20,
            ]);

            $status = $response->getStatusCode();
            $data = $response->toArray(false);

            if ($status !== 200 || !($data['success'] ?? false)) {
                return $this->json([
                    'ok' => false,
                    'error' => $data['error'] ?? ('The website rejected the game (HTTP ' . $status . ').'),
                ], 502);
            }

            return $this->json([
                'ok' => true,
                'date' => $date,
                'playerCount' => count($players),
                'gameId' => $data['game']['id'] ?? null,
            ]);

        } catch (\Throwable $e) {
            return $this->json([
                'ok' => false,
                'error' => 'Could not reach the website. The game was NOT recorded.',
            ], 502);
        }
    }
}
