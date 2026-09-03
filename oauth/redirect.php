<?php
/**
 * ログイン後の戻り先（redirect_to）を検証するヘルパー。
 *
 * redirect_to はクエリ文字列から来る外部入力なので、そのまま Location に
 * 渡すとオープンリダイレクトになる。同一サイトの絶対パスだけを通す。
 */

declare(strict_types=1);

/**
 * redirect_to を安全な同一サイトのパスへ正規化する。
 * 通せない値はすべてトップ（'/'）へ落とす。
 *
 * @param  string|null $raw クエリから受け取った生の値
 * @return string           '/' で始まる同一サイトのパス
 */
function auriga_safe_redirect_to(?string $raw): string
{
    $path = trim((string) $raw);

    // 空・相対パス・スキーム付き（https://evil.example）はすべて拒否する
    if ($path === '' || $path[0] !== '/') {
        return '/';
    }
    // '//evil.example' と '/\evil.example' はブラウザが別ホストとして解釈するため拒否する
    if (str_starts_with($path, '//') || str_starts_with($path, '/\\')) {
        return '/';
    }
    // 改行や制御文字はヘッダーインジェクションになるため拒否する
    if (preg_match('/[\x00-\x1F\x7F]/', $path) === 1) {
        return '/';
    }

    return $path;
}

/**
 * 認可に失敗（キャンセル含む）したとき、操作前のログイン／新規登録ページへ戻す。
 *
 * エラー本文はクエリに載せるとそのまま画面に出せてしまうので、セッションで渡す。
 * 受け取り側は auth-page.php で、oauth_error を読んで捨てる。
 * 呼び出し前に session_start() が済んでいること。
 */
function auriga_redirect_to_auth_page(string $message): void
{
    $_SESSION['oauth_error'] = $message;

    // 直前に開いていたのがログインか新規登録かで戻り先を変える
    $page = (($_SESSION['oauth_auth_mode'] ?? 'login') === 'signup') ? '/signup' : '/login';
    $back = auriga_safe_redirect_to($_SESSION['oauth_redirect_to'] ?? '/');

    header('Location: ' . $page . '?redirect_to=' . rawurlencode($back));
    exit;
}
