<?php
/**
 * パスワード再設定メールの送信ページ（/sessions/forgot_password）の見た目。
 *
 * ⚠ ダミー。ユーザー DB とメール送信手段が無いため、送信ボタンは無効。
 *    実装するときは g-recaptcha-response を auriga_verify_recaptcha() で検証してから、
 *    登録済みメールアドレスにだけ再設定リンクを送ること
 *    （未登録アドレスでも同じ応答を返し、登録の有無を漏らさないこと）。
 */

declare(strict_types=1);

require_once __DIR__ . '/auth-styles.php';
require_once __DIR__ . '/recaptcha.php';

/**
 * パスワード再設定ページを出力する。
 *
 * @param string $redirectTo ログインページへ引き継ぐ戻り先
 */
function auriga_render_forgot_password_html(string $redirectTo): void
{
    $loginHref = '/login?redirect_to=' . rawurlencode($redirectTo);

    header('Content-Type: text/html; charset=UTF-8');
    ?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>パスワード再設定 | Auriga Studio</title>
    <link rel="icon" href="/favicon.svg">
    <?php auriga_auth_styles(); ?>
</head>
<body>
<div class="sheet">
    <h1 class="sheet__title">パスワード再設定メールを送る</h1>

    <form onsubmit="return false;">
        <div class="field">
            <label class="field__label" for="fpMail">メールアドレス</label>
            <p class="field__hint field__hint--info">Auriga Labsに登録されたメールアドレスのみ送信可能です。</p>
            <input class="field__input" id="fpMail" type="email" autocomplete="email">
        </div>

        <a class="link-sub" href="/privacy.html">パスワード再設定に関するヘルプ</a>

        <!-- reCAPTCHA v2。送信時は g-recaptcha-response を
             auriga_verify_recaptcha() で検証すること -->
        <div class="recaptcha g-recaptcha" data-sitekey="<?= htmlspecialchars(RECAPTCHA_SITE_KEY) ?>"></div>

        <button class="btn-submit btn-submit--sm" type="submit" disabled>送信</button>
        <p class="form-note">※ パスワード再設定メールの送信は準備中です。</p>
    </form>

    <p class="foot">
        📣 <a href="<?= htmlspecialchars($loginHref) ?>">ログイン</a>に戻る
    </p>
</div>
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
</body>
</html>
    <?php
}
