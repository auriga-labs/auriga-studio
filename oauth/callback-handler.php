<?php
/**
 * Google 以外のプロバイダー共通のコールバック処理。
 *
 * callback-github.php / callback-x.php / callback-apple.php / callback-line.php
 * から呼ぶ。処理の流れは callback.php（Google）と同じで、
 * プロバイダー固有の部分だけ AurigaOAuthProvider に委ねている。
 */

declare(strict_types=1);

require_once __DIR__ . '/redirect.php';

/**
 * 認可後のリダイレクトを受け取り、セッションにユーザーを保存して戻す。
 * この関数の中で session_start() まで行うので、呼び出し側では不要。
 */
function auriga_handle_oauth_callback(AurigaOAuthProvider $provider): void
{
    session_start();

    // Apple は response_mode=form_post なので POST で返ってくる
    $request = (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') ? $_POST : $_GET;

    // アプリ（Electron）起点かどうかは state の 'app.' プレフィックスで判別する。
    // アプリ起点はサーバーセッションに state を持たないので照合はクライアント側で行う。
    $reqState = (string) ($request['state'] ?? '');
    $isApp    = str_starts_with($reqState, 'app.');

    // アプリ起点ならブリッジでエラーを返し、通常は die する共通ハンドラ
    $failAuth = function (string $message) use ($isApp, $reqState): void {
        if ($isApp) {
            render_app_bridge(null, $message, $reqState);
            exit;
        }
        die(htmlspecialchars($message));
    };

    // ── 1. エラーチェック ────────────────────────────────────────────────
    if (isset($request['error'])) {
        $failAuth($provider->label() . 'ログインがキャンセルされました: ' . (string) $request['error']);
    }

    // ── 2. 必須パラメータの確認 ──────────────────────────────────────────
    if (empty($request['code']) || $reqState === '') {
        $failAuth('不正なリクエストです。');
    }

    // ── 3. CSRF対策: stateパラメータの検証 ──────────────────────────────
    $stateKey = 'oauth_state_' . $provider->key();
    if (!$isApp) {
        if (!hash_equals($_SESSION[$stateKey] ?? '', $reqState)) {
            $failAuth('セキュリティエラー: stateが一致しません。');
        }
        unset($_SESSION[$stateKey]);   // 使い捨て
    }

    // ── 4. 認可コード → アクセストークン → ユーザー情報 ─────────────────
    $tokens = [];
    $user   = [];
    try {
        $tokens = $provider->fetchTokens((string) $request['code']);
        $user   = $provider->fetchUserInfo($tokens);
    } catch (RuntimeException $e) {
        $failAuth('認証エラー: ' . $e->getMessage());
    }

    // ── 5. セッションにユーザー情報を保存 ────────────────────────────────
    //    本番環境ではここでDBにユーザーを保存・更新する
    session_regenerate_id(true);   // セッション固定攻撃対策

    $_SESSION['user'] = [
        'id'       => $user['id'],
        'email'    => $user['email'],
        'name'     => $user['name'],
        'picture'  => $user['picture'],
        'verified' => $user['verified'],
        'provider' => $provider->key(),
    ];

    $_SESSION['access_token']     = $tokens['access_token'] ?? null;
    $_SESSION['token_expires_at'] = time() + (int) ($tokens['expires_in'] ?? 0);

    // ── 6. 遷移先の振り分け ─────────────────────────────────────────────
    if ($isApp) {
        render_app_bridge($_SESSION['user'], '', $reqState, $tokens);
        exit;
    }

    $back = $_SESSION['oauth_redirect_to'] ?? '';
    unset($_SESSION['oauth_redirect_to']);   // 使い捨て

    header('Location: ' . ($back !== '' ? auriga_safe_redirect_to($back) : 'dashboard.php'));
    exit;
}
