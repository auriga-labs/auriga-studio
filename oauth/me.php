<?php
/**
 * 現在のログイン状態を JSON で返す。
 *
 * /login からブラウザで認証した後、戻ってきたアプリ（index.html）が
 * セッションのユーザーを拾い直すために使う。
 */

declare(strict_types=1);

// セッションの cookie 設定は config.php で行うので、session_start より先に読む
$configPath = __DIR__ . '/config.php';
if (file_exists($configPath)) {
    require_once $configPath;
}

session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$user = $_SESSION['user'] ?? null;
if (!$user) {
    echo json_encode(['user' => null]);
    exit;
}

// アクセストークンは短命なので、期限が切れていれば渡さない
$expiresAt = (int) ($_SESSION['token_expires_at'] ?? 0);
$remaining = $expiresAt - time();
$token     = ($remaining > 60) ? ($_SESSION['access_token'] ?? null) : null;

echo json_encode([
    'user'         => $user,
    'access_token' => $token,
    'expires_in'   => $token ? $remaining : null,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
