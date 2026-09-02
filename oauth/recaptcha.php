<?php
/**
 * reCAPTCHA v2（チェックボックス）。
 *
 * サイトキーは HTML に埋め込まれる公開値なのでここに持つ。
 * シークレットキーは oauth/config.php（.gitignore 済み）の RECAPTCHA_SECRET_KEY から読む。
 */

declare(strict_types=1);

// 公開値（ページの <script> と data-sitekey に埋まる）
define('RECAPTCHA_SITE_KEY', '6LfKtqUtAAAAAJvSo17TXyjWKg2nTe1yfpQ_buEq');

/**
 * フォームから送られた g-recaptcha-response を Google に検証してもらう。
 * メールアドレス登録を実装したら、登録処理の先頭でこれを通すこと。
 *
 * @param  string $response フォームの g-recaptcha-response
 * @param  string $remoteIp 任意。利用者の IP
 * @return bool             検証に成功したか
 */
function auriga_verify_recaptcha(string $response, string $remoteIp = ''): bool
{
    if ($response === '' || !defined('RECAPTCHA_SECRET_KEY')) {
        return false;
    }

    $ch = curl_init('https://www.google.com/recaptcha/api/siteverify');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_POSTFIELDS     => http_build_query(array_filter([
            'secret'   => RECAPTCHA_SECRET_KEY,
            'response' => $response,
            'remoteip' => $remoteIp,
        ])),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);

    if ($body === false) {
        return false;
    }
    $data = json_decode($body, true);

    return ($data['success'] ?? false) === true;
}
