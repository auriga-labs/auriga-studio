<?php
/**
 * Google OAuth2.0 コールバックハンドラ
 * Googleがこのページにリダイレクトしてくる
 */

require_once 'config.php';
require_once 'oauth.php';

session_start();

// アプリ（Electron）起点かどうかは state の 'app.' プレフィックスで判別する。
// アプリ起点は Google を直接開くためサーバーセッションに oauth_state を持たない。
// その場合 state の照合はクライアント側で行うので、ここでは形式判定のみ。
$reqState = $_GET['state'] ?? '';
$isApp = str_starts_with($reqState, 'app.');

// アプリ起点ならブリッジでエラーを返し、通常は die する共通ハンドラ
$failAuth = function (string $message) use ($isApp, $reqState) {
    if ($isApp) {
        render_app_bridge(null, $message, $reqState);
        exit;
    }
    die(htmlspecialchars($message));
};

// ── 1. エラーチェック ────────────────────────────────────────────────────
if (isset($_GET['error'])) {
    $failAuth('Googleログインがキャンセルされました: ' . $_GET['error']);
}

// ── 2. 必須パラメータの確認 ──────────────────────────────────────────────
if (empty($_GET['code']) || empty($reqState)) {
    $failAuth('不正なリクエストです。');
}

// ── 3. CSRF対策: stateパラメータの検証 ──────────────────────────────────
if ($isApp) {
    // アプリ起点: state はクライアント側で照合する（サーバーにセッション無し）。
} else {
    if (!hash_equals($_SESSION['oauth_state'] ?? '', $reqState)) {
        $failAuth('セキュリティエラー: stateが一致しません。');
    }
    unset($_SESSION['oauth_state']); // 使い捨て
}

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
// ブリッジページを返してログインタブから親ウィンドウへ結果を渡す。
if ($isApp) {
    // access_token も渡し、アプリ側から Drive API を直接呼べるようにする
    render_app_bridge($_SESSION['user'], '', $reqState, $tokens);
    exit;
}

// 通常（Webブラウザ）はダッシュボードへリダイレクト
header('Location: dashboard.php');
exit;
