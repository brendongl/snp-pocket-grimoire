<?php
// Isolated proxy contract test; MockHttpClient makes no network requests.
require __DIR__ . '/../vendor/autoload.php';

use App\Controller\SnpController;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\HttpFoundation\Request;

function check($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}
$_ENV['SNP_BRIDGE_URL'] = 'https://site.invalid';
$_ENV['SNP_BRIDGE_KEY'] = 'test-key-not-for-browser';
$sent = null;
$client = new MockHttpClient(function ($method, $url, $options) use (&$sent) {
    $sent = json_decode($options['body'], true);
    return new MockResponse(json_encode(['success' => true, 'game' => ['id' => 'test-game']]));
});
$controller = new SnpController($client);
$controller->setContainer(new Container());
$body = ['date' => '2026-11-01', 'winningTeam' => 'good', 'players' => [
    ['name' => 'Test player', 'characterName' => 'Imp', 'characterTeam' => 'demon'],
]];
$png = 'data:image/png;base64,iVBORw0KGgo='; // Proxy checks shape; site validates the actual PNG.
$request = function ($body) { return new Request([], [], [], [], [], [], json_encode($body)); };
$response = $controller->report($request($body + ['grimoireImage' => $png]));
check($response->getStatusCode() === 200, 'PNG report failed');
check($sent['grimoireImage'] === $png, 'Preview bytes changed/lost in proxy');
check(strpos($response->getContent(), $_ENV['SNP_BRIDGE_KEY']) === false, 'Key leaked');
$response = $controller->report($request($body));
check($response->getStatusCode() === 200 && !isset($sent['grimoireImage']), 'Legacy report failed');
foreach ([123, 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' . str_repeat('A', 5592430)] as $bad) {
    check($controller->report($request($body + ['grimoireImage' => $bad]))->getStatusCode() === 400, 'Invalid picture accepted');
}
check($controller->report($request($body + ['notes' => str_repeat('x', 5854553)]))->getStatusCode() === 413, 'Oversized request accepted');
echo "PASS: PNG proxy forwarding, legacy reports, no key leak, invalid image and oversized body rejection.\n";
