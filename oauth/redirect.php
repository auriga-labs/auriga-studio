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
