<?php
/**
 * ログアウト処理
 */

require_once __DIR__ . '/redirect.php';

session_start();

// アプリ（Electron）起点のログアウトか
$isApp = isset($_GET['app']);

// ブラウザからのログアウトは、指定があればその画面へ戻す
$back = auriga_safe_redirect_to($_GET['redirect_to'] ?? '');

// セッションデータをすべて削除
$_SESSION = [];

// セッションクッキーを削除
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(
        session_name(),
        '',
        time() - 42000,
        $params['path'],
        $params['domain'],
        $params['secure'],
        $params['httponly']
    );
}

session_destroy();

// アプリ起点なら自分自身を閉じる小さなページを返す
if ($isApp) {
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
        . '<title>ログアウト</title></head><body>'
        . '<script>setTimeout(function(){window.close();},150);</script>'
        . '</body></html>';
    exit;
}

// redirect_to の指定が無ければ従来どおり index.php へ
header('Location: ' . (isset($_GET['redirect_to']) ? $back : 'index.php'));
exit;
