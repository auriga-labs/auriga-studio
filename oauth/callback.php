<?php
/**
 * Google OAuth2.0 コールバックハンドラ
 * Googleがこのページにリダイレクトしてくる
 */

require_once 'config.php';
require_once 'oauth.php';

session_start();

// アプリ起点かどうか。エラー時もブリッジで親へ通知できるようにする。
$isApp = !empty($_SESSION['oauth_app']);

// アプリ起点ならブリッジでエラーを返し、通常は die する共通ハンドラ
$failAuth = function (string $message) use ($isApp) {
    if ($isApp) {
        unset($_SESSION['oauth_app']);
        render_app_bridge(null, $message);
        exit;
    }
    die(htmlspecialchars($message));
};

// ── 1. エラーチェック ────────────────────────────────────────────────────
if (isset($_GET['error'])) {
    $failAuth('Googleログインがキャンセルされました: ' . $_GET['error']);
}

// ── 2. 必須パラメータの確認 ──────────────────────────────────────────────
if (empty($_GET['code']) || empty($_GET['state'])) {
    $failAuth('不正なリクエストです。');
}

// ── 3. CSRF対策: stateパラメータの検証 ──────────────────────────────────
if (!hash_equals($_SESSION['oauth_state'] ?? '', $_GET['state'])) {
    $failAuth('セキュリティエラー: stateが一致しません。');
}
unset($_SESSION['oauth_state']); // 使い捨て

// ── 4. 認可コード → アクセストークン ────────────────────────────────────
try {
    $auth   = new GoogleOAuth();
    $tokens = $auth->fetchTokens($_GET['code']);
    $user   = $auth->fetchUserInfo($tokens['access_token']);
} catch (RuntimeException $e) {
    $failAuth('認証エラー: ' . $e->getMessage());
}

// ── 5. セッションにユーザー情報を保存 ────────────────────────────────────
//    本番環境ではここでDBにユーザーを保存・更新する
session_regenerate_id(true); // セッション固定攻撃対策

$_SESSION['user'] = [
    'id'      => $user['sub'],          // GoogleのユニークID
    'email'   => $user['email'],
    'name'    => $user['name'],
    'picture' => $user['picture'],
    'verified'=> $user['email_verified'] ?? false,
];

// ── 6. 遷移先の振り分け ─────────────────────────────────────────────────
// アプリ（Electron）起点のログインなら、ダッシュボードではなく
// ブリッジページを返してポップアップから親ウィンドウへ結果を渡す。
if (!empty($_SESSION['oauth_app'])) {
    unset($_SESSION['oauth_app']);
    render_app_bridge($_SESSION['user']);
    exit;
}

// 通常（Webブラウザ）はダッシュボードへリダイレクト
header('Location: dashboard.php');
exit;
