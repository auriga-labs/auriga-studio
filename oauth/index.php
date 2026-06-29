<?php
/**
 * Google OAuth2.0 - ログインページ
 */

require_once 'config.php';
require_once 'oauth.php';

session_start();

// Auriga Studio アプリ（Electron）からのログインかどうかを記録する。
// アプリ起点の場合は callback で dashboard ではなくブリッジページを返す。
if (isset($_GET['app'])) {
    $_SESSION['oauth_app'] = true;
}

// すでにログイン済みの場合
if (isset($_SESSION['user'])) {
    // アプリ起点ならブリッジでユーザー情報を返す、通常はダッシュボードへ
    if (!empty($_SESSION['oauth_app'])) {
        unset($_SESSION['oauth_app']);
        render_app_bridge($_SESSION['user']);
        exit;
    }
    header('Location: dashboard.php');
    exit;
}

$auth = new GoogleOAuth();
$loginUrl = $auth->getAuthorizationUrl();
?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Googleログイン</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background: #f0f4f8;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            padding: 48px 40px;
            width: 360px;
            text-align: center;
        }
        .card h1 {
            font-size: 22px;
            font-weight: 600;
            color: #1a1a2e;
            margin-bottom: 8px;
        }
        .card p {
            font-size: 14px;
            color: #6b7280;
            margin-bottom: 32px;
        }
        .btn-google {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            width: 100%;
            padding: 12px 20px;
            background: #fff;
            border: 1.5px solid #d1d5db;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 500;
            color: #374151;
            text-decoration: none;
            transition: background 0.15s, box-shadow 0.15s;
        }
        .btn-google:hover {
            background: #f9fafb;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .btn-google svg { flex-shrink: 0; }
        .divider {
            margin: 24px 0;
            border: none;
            border-top: 1px solid #e5e7eb;
        }
        .note {
            font-size: 12px;
            color: #9ca3af;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>ようこそ</h1>
        <p>続けるにはGoogleアカウントでログインしてください</p>
        <a href="<?= htmlspecialchars($loginUrl) ?>" class="btn-google">
            <!-- Google "G" ロゴ -->
            <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Googleでログイン
        </a>
        <hr class="divider">
        <p class="note">このサイトはGoogleの認証を使用します</p>
    </div>
</body>
</html>
