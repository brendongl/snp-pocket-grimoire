<?php

namespace App\EventListener;

use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * [snp] Gate the grimoire behind a signed link issued by sipnplay.cafe.
 *
 * Pocket Grimoire has no authentication of its own — no login, no users, no sessions —
 * and whoever reaches it can see every player's character. Once it is reachable from
 * outside the shop LAN that becomes a real problem, so entry is decided by the website,
 * which already knows who is organising a given night, and carried here as a signed
 * claim.
 *
 *   /snp/enter?token=...  ->  verify  ->  set a cookie  ->  redirect to the board
 *
 * The token format is minted by lib/botc/grimoire-token.ts in snp-site:
 *
 *   base64url(json payload) "." base64url(HMAC-SHA256(that base64url string, secret))
 *
 * If you change it there, change it here.
 *
 * > OFF BY DEFAULT. With no GRIMOIRE_TOKEN_SECRET set, every request passes through
 * > untouched. That keeps the LAN-only deployment working exactly as it does today —
 * > turning the gate on is a deliberate act, not something that happens by upgrading.
 */
class SnpAccessListener implements EventSubscriberInterface
{

    private const COOKIE_NAME = 'snp_grimoire';
    private const ENTER_PATH = '/snp/enter';

    /** Reachable without a token: health checks and the assets a 403 page needs. */
    private const ALWAYS_ALLOWED = [
        '/snp/enter',
    ];

    private $secret;

    /** @var Cookie|null Set during the request, attached on the response. */
    private $issue = null;

    public function __construct()
    {
        $this->secret = (string) ($_ENV['GRIMOIRE_TOKEN_SECRET'] ?? '');
    }

    public static function getSubscribedEvents(): array
    {
        return [
            // Priority 40 — ABOVE Symfony's RouterListener (32), deliberately.
            //
            // An access gate must not depend on routing. At a lower priority the router
            // runs first and throws 404 for /snp/enter, which has no route of its own,
            // so a perfectly valid token was rejected before this listener ever saw it.
            // Running first also means an unauthenticated request to any path — routed
            // or not — is refused rather than revealing which paths exist.
            KernelEvents::REQUEST => ['onRequest', 40],
            KernelEvents::RESPONSE => ['onResponse', 0],
        ];
    }

    private function isEnabled(): bool
    {
        return $this->secret !== '';
    }

    public function onRequest(RequestEvent $event): void
    {
        if (!$this->isEnabled() || !$event->isMainRequest()) {
            return;
        }

        $request = $event->getRequest();
        $path = $request->getPathInfo();

        // Static assets are served by Apache before PHP is reached, so nothing here
        // needs to exempt them. Anything that does reach PHP is a real page.

        if ($path === self::ENTER_PATH) {

            $payload = $this->verify((string) $request->query->get('token', ''));

            if ($payload === null) {
                $event->setResponse($this->refuse(
                    'That link is not valid, or it has expired. Open the grimoire again from sipnplay.cafe.'
                ));
                return;
            }

            // The cookie dies with the token, so a browser left logged in is only
            // logged in for as long as the link would have been.
            $lifetime = max(60, ((int) $payload['exp']) - time());

            $this->issue = Cookie::create(self::COOKIE_NAME)
                ->withValue((string) $request->query->get('token', ''))
                ->withExpires(time() + $lifetime)
                ->withPath('/')
                ->withHttpOnly(true)
                ->withSecure($this->isSecureRequest($request))
                ->withSameSite(Cookie::SAMESITE_LAX);

            // Carry ?date= through so the board loads the right night's sign-ups, and
            // drop the token from the URL so it does not sit in history or get shared
            // by someone copying the address bar.
            $date = (string) $request->query->get('date', '');
            $target = '/' . (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? '?date=' . $date : '');

            $event->setResponse(new RedirectResponse($target));
            return;
        }

        if ($this->verify((string) $request->cookies->get(self::COOKIE_NAME, '')) === null) {
            $event->setResponse($this->refuse(
                'The grimoire is opened from sipnplay.cafe by the storyteller running tonight.'
            ));
        }
    }

    public function onResponse(ResponseEvent $event): void
    {
        if ($this->issue !== null && $event->isMainRequest()) {
            $event->getResponse()->headers->setCookie($this->issue);
            $this->issue = null;
        }
    }

    /**
     * Did this request reach the *user* over HTTPS?
     *
     * `$request->isSecure()` alone says no behind the Cloudflare tunnel: cloudflared
     * terminates TLS at the edge and speaks plain HTTP to this container, so the entry
     * cookie was being issued without the Secure flag even though the browser was on
     * https. That is a cookie that a downgrade could put on the wire.
     *
     * X-Forwarded-Proto comes from cloudflared, which is the only thing that reaches us
     * that way; a LAN client on plain http sets no such header and correctly gets a
     * non-Secure cookie, which it needs, since a Secure cookie would never be sent back
     * over http://192.168.50.110:8088.
     *
     * Read directly rather than via trusted_proxies, so this stays a local decision
     * about one cookie instead of changing how the whole framework treats forwarded
     * headers.
     */
    private function isSecureRequest($request): bool
    {
        if ($request->isSecure()) {
            return true;
        }

        return strtolower((string) $request->headers->get('x-forwarded-proto', '')) === 'https';
    }

    /**
     * @return array|null The payload, or null for anything wrong.
     */
    private function verify(string $token): ?array
    {
        if ($token === '') {
            return null;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return null;
        }

        [$body, $presented] = $parts;

        $expected = $this->base64UrlEncode(
            hash_hmac('sha256', $body, $this->secret, true)
        );

        // Constant time, so a wrong signature cannot be discovered a character at a time.
        if (!hash_equals($expected, $presented)) {
            return null;
        }

        $decoded = json_decode($this->base64UrlDecode($body), true);

        if (!is_array($decoded) || !isset($decoded['exp']) || !is_int($decoded['exp'])) {
            return null;
        }

        if ($decoded['exp'] < time()) {
            return null;
        }

        return $decoded;
    }

    private function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $encoded): string
    {
        $padded = strtr($encoded, '-_', '+/');
        $remainder = strlen($padded) % 4;
        if ($remainder !== 0) {
            $padded .= str_repeat('=', 4 - $remainder);
        }

        return (string) base64_decode($padded, true);
    }

    private function refuse(string $message): Response
    {
        $safe = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');

        return new Response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>Grimoire</title>'
            . '<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;'
            . 'display:flex;align-items:center;justify-content:center;background:#2b1405;'
            . 'color:#f5e6d3;padding:2rem;text-align:center;line-height:1.6}'
            . 'div{max-width:32rem}h1{font-size:1.25rem;margin:0 0 .75rem}'
            . 'p{margin:0;opacity:.85;font-size:.95rem}</style></head>'
            . '<body><div><h1>Not your grimoire</h1><p>' . $safe . '</p></div></body></html>',
            Response::HTTP_FORBIDDEN,
            ['Content-Type' => 'text/html; charset=utf-8']
        );
    }
}
