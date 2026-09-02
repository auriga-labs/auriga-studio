<?php
/**
 * ログイン／新規登録／パスワード再設定ページの共通処理。
 *
 * ルートの login.php / signup.php と sessions/forgot_password.php から呼ぶ。
 * 見た目は login-view.php / signup-view.php / forgot-password-view.php が持つ。
 * 実際に動く認証は Google OAuth のみで、新規登録も同じ認可フローを使う
 * （初回ログイン時にそのままアカウントが作られる）。
 */

declare(strict_types=1);

require_once __DIR__ . '/redirect.php';
require_once __DIR__ . '/login-view.php';
require_once __DIR__ . '/signup-view.php';
require_once __DIR__ . '/forgot-password-view.php';

/**
 * ログイン／新規登録ページを表示する。
 *
 * @param string $mode 'login' または 'signup'
 */
function auriga_render_auth_page(string $mode): void
{
    $isSignUp = ($mode === 'signup');

    // 戻り先。'/login?redirect_to=%2F' の %2F をデコードした値が入る
    $redirectTo = auriga_safe_redirect_to($_GET['redirect_to'] ?? '/');

    // config.php は手動デプロイ（gitignore 管理）なので、無い環境では準備中を返す
    $configPath = __DIR__ . '/config.php';
    if (!file_exists($configPath)) {
        http_response_code(503);
        $isSignUp
            ? auriga_render_signup_html($redirectTo, null)
            : auriga_render_login_html($redirectTo, null, '認証は準備中です。しばらくお待ちください。');
        exit;
    }

    // セッションの cookie 設定は config.php で行うので、session_start より先に読む
    require_once $configPath;
    require_once __DIR__ . '/oauth.php';

    session_start();

    // すでにログイン済みなら認可画面を挟まずそのまま戻す
    if (isset($_SESSION['user'])) {
        header('Location: ' . $redirectTo);
        exit;
    }

    // 認可後に callback.php が読む戻り先を預けておく
    $_SESSION['oauth_redirect_to'] = $redirectTo;

    $auth = new GoogleOAuth();
    $isSignUp
        ? auriga_render_signup_html($redirectTo, $auth->getAuthorizationUrl())
        : auriga_render_login_html($redirectTo, $auth->getAuthorizationUrl());
}

/**
 * パスワード再設定ページを表示する。
 * Google 認可 URL は使わないので、config.php の有無にかかわらず同じ画面を出す。
 */
function auriga_render_forgot_password_page(): void
{
    auriga_render_forgot_password_html(auriga_safe_redirect_to($_GET['redirect_to'] ?? '/'));
}
