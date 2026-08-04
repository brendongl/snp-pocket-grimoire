<?php
/**
 * [snp] Cross-language check on the grimoire token format.
 *
 *   php docker/test-token-compat.php '<token from snp-site>' '<secret>'
 *
 * Two implementations have to agree byte for byte — lib/botc/grimoire-token.ts in
 * snp-site mints these, SnpAccessListener verifies them — and they are written in
 * different languages by different people at different times. A mismatch would lock
 * every storyteller out with no useful error, so it is worth an explicit test rather
 * than an assumption that base64url means the same thing in Node and PHP.
 *
 * Exits non-zero if the token does not verify.
 */

$token = $argv[1] ?? '';
$secret = $argv[2] ?? (string) ($_ENV['GRIMOIRE_TOKEN_SECRET'] ?? getenv('GRIMOIRE_TOKEN_SECRET'));

if ($token === '' || $secret === '') {
    fwrite(STDERR, "usage: php test-token-compat.php <token> <secret>\n");
    exit(2);
}

function b64url_encode(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function b64url_decode(string $encoded): string
{
    $padded = strtr($encoded, '-_', '+/');
    $remainder = strlen($padded) % 4;
    if ($remainder !== 0) {
        $padded .= str_repeat('=', 4 - $remainder);
    }
    return (string) base64_decode($padded, true);
}

$parts = explode('.', $token);
if (count($parts) !== 2) {
    fwrite(STDERR, "FAIL: expected exactly 2 dot-separated parts, got " . count($parts) . "\n");
    exit(1);
}

[$body, $presented] = $parts;

$expected = b64url_encode(hash_hmac('sha256', $body, $secret, true));

echo "signature presented : {$presented}\n";
echo "signature computed  : {$expected}\n";

if (!hash_equals($expected, $presented)) {
    fwrite(STDERR, "FAIL: signatures differ — the two implementations disagree\n");
    exit(1);
}
echo "OK: signature matches\n";

$payload = json_decode(b64url_decode($body), true);
if (!is_array($payload)) {
    fwrite(STDERR, "FAIL: payload did not decode to an array\n");
    exit(1);
}

echo "payload             : " . json_encode($payload) . "\n";

foreach (['sub', 'date', 'exp', 'jti'] as $key) {
    if (!array_key_exists($key, $payload)) {
        fwrite(STDERR, "FAIL: payload is missing '{$key}'\n");
        exit(1);
    }
}
echo "OK: payload has sub, date, exp, jti\n";

if (!is_int($payload['exp'])) {
    fwrite(STDERR, "FAIL: exp is not an integer (PHP would reject this token)\n");
    exit(1);
}

$remaining = $payload['exp'] - time();
echo "expires in          : {$remaining}s (" . gmdate('Y-m-d H:i:s', $payload['exp']) . " UTC)\n";

if ($remaining <= 0) {
    fwrite(STDERR, "FAIL: already expired\n");
    exit(1);
}

echo "\nPASS: snp-site and the grimoire agree on this token.\n";
