<?php
/**
 * ログイン／新規登録ページの共通処理。
 *
 * ルートの login.php / signup.php から $mode を指定して読み込む。
 * ログインの見た目はこのファイル、新規登録の見た目は signup-view.php が持つ。
 * 実際に動く認証は Google OAuth のみで、新規登録も同じ認可フローを使う
 * （初回ログイン時にそのままアカウントが作られる）。
 */

declare(strict_types=1);

require_once __DIR__ . '/redirect.php';
require_once __DIR__ . '/signup-view.php';

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
            : auriga_render_auth_html($redirectTo, null, '認証は準備中です。しばらくお待ちください。');
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
        : auriga_render_auth_html($redirectTo, $auth->getAuthorizationUrl(), '');
}

/**
 * ログインページ本体を出力する。
 *
 * @param string      $redirectTo 戻り先（新規登録ページへのリンクに引き継ぐ）
 * @param string|null $loginUrl   Google 認可 URL。null なら利用不可の表示にする
 * @param string      $message    利用不可の理由（$loginUrl が null のとき表示）
 */
function auriga_render_auth_html(string $redirectTo, ?string $loginUrl, string $message): void
{
    $title      = 'ログイン';
    $lead       = '続けるには Google アカウントでログインしてください';
    $buttonText = 'Google でログイン';
    $switchHref = '/signup?redirect_to=' . rawurlencode($redirectTo);
    $switchText = 'アカウントをお持ちでない方は 新規登録';

    header('Content-Type: text/html; charset=UTF-8');
    ?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($title) ?> | Auriga Studio</title>
    <link rel="icon" href="/favicon.svg">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background: #f0f4f8;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, .08);
            padding: 48px 40px;
            width: 100%;
            max-width: 360px;
            text-align: center;
        }
        .card__logo { width: 44px; height: 44px; margin: 0 auto 16px; display: block; }
        .card h1 { font-size: 22px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; }
        .card p.lead { font-size: 14px; color: #6b7280; margin-bottom: 32px; }
        .btn-google {
            display: flex; align-items: center; justify-content: center; gap: 12px;
            width: 100%; padding: 12px 20px;
            background: #fff;
            border: 1.5px solid #d1d5db;
            border-radius: 8px;
            font-size: 15px; font-weight: 500; color: #374151;
            text-decoration: none;
            transition: background .15s, box-shadow .15s;
        }
        .btn-google:hover { background: #f9fafb; box-shadow: 0 2px 8px rgba(0, 0, 0, .08); }
        .btn-google svg { flex-shrink: 0; }
        .switch { display: block; margin-top: 20px; font-size: 13px; color: #4b5563; }
        .switch:hover { color: #1a1a2e; }
        .divider { margin: 24px 0; border: none; border-top: 1px solid #e5e7eb; }
        .note { font-size: 12px; color: #9ca3af; }
        .note a { color: #9ca3af; }
        .error { font-size: 14px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; }
    </style>
</head>
<body>
    <div class="card">
        <img class="card__logo" src="/favicon-symbol.svg" alt="Auriga Studio" width="44" height="44">
        <h1><?= htmlspecialchars($title) ?></h1>
        <p class="lead"><?= htmlspecialchars($lead) ?></p>

        <?php if ($loginUrl !== null): ?>
            <a href="<?= htmlspecialchars($loginUrl) ?>" class="btn-google">
                <!-- Google "G" ロゴ -->
                <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                <?= htmlspecialchars($buttonText) ?>
            </a>
            <a class="switch" href="<?= htmlspecialchars($switchHref) ?>"><?= htmlspecialchars($switchText) ?></a>
        <?php else: ?>
            <p class="error"><?= htmlspecialchars($message) ?></p>
        <?php endif; ?>

        <hr class="divider">
        <p class="note">
            このサイトは Google の認証を使用します<br>
            <a href="/privacy.html">プライバシーポリシー</a>
        </p>
    </div>
</body>
</html>
    <?php
}
