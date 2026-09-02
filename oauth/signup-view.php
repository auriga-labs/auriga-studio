<?php
/**
 * 新規登録ページ（/signup）の見た目。
 *
 * ⚠ 現時点ではメールアドレス登録と GitHub / X(Twitter) はダミー。
 *    ユーザー DB が無く、GitHub / X の OAuth アプリも未作成のため、動くのは
 *    Google の認可リンクと reCAPTCHA ウィジェットだけ。
 *    メール登録を実装するときは auriga_verify_recaptcha() を通すこと。
 */

declare(strict_types=1);

require_once __DIR__ . '/auth-styles.php';
require_once __DIR__ . '/social-buttons.php';
require_once __DIR__ . '/recaptcha.php';

/**
 * 新規登録ページを出力する。
 *
 * @param string      $redirectTo ログインページへ引き継ぐ戻り先
 * @param string|null $googleUrl  Google 認可 URL。null なら Google も押せない（未設定環境）
 */
function auriga_render_signup_html(string $redirectTo, ?string $googleUrl): void
{
    $loginHref = '/login?redirect_to=' . rawurlencode($redirectTo);

    header('Content-Type: text/html; charset=UTF-8');
    ?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>新規登録 | Auriga Studio</title>
    <link rel="icon" href="/favicon.svg">
    <?php auriga_auth_styles(); ?>
</head>
<body>
<div class="sheet">
    <h1 class="sheet__title">Auriga Labsへようこそ!</h1>
    <p class="sheet__lead">新規登録(無料)して利用を開始しましょう。</p>

    <div class="cols">
        <!-- 左: メールアドレス登録（ダミー。ユーザー DB が無いので送信先を持たない） -->
        <section>
            <h2 class="col__title">メールアドレスで新規登録</h2>
            <div class="form-box">
                <form onsubmit="return false;">
                    <div class="field">
                        <label class="field__label" for="suUser">ユーザー名 <span class="badge-req">必須</span></label>
                        <p class="field__hint">半角英数字で、最大30文字で入力してください</p>
                        <input class="field__input" id="suUser" type="text" placeholder="ユーザー名" autocomplete="username">
                    </div>
                    <div class="field">
                        <label class="field__label" for="suMail">メールアドレス <span class="badge-req">必須</span></label>
                        <input class="field__input" id="suMail" type="email" placeholder="メールアドレス" autocomplete="email" style="margin-top:6px">
                    </div>
                    <div class="field">
                        <label class="field__label" for="suPass">パスワード <span class="badge-req">必須</span></label>
                        <p class="field__hint field__hint--warn">パスワードは8文字以上32文字以内で、半角英字・数字・記号が使えます。</p>
                        <input class="field__input" id="suPass" type="password" placeholder="パスワード" autocomplete="new-password">
                    </div>

                    <label class="agree"><input type="checkbox"> <a href="/terms.html">利用規約</a>に同意する</label>
                    <label class="agree"><input type="checkbox"> <a href="/privacy.html">プライバシーポリシー</a>に同意する</label>

                    <!-- reCAPTCHA v2。送信時は g-recaptcha-response を
                         auriga_verify_recaptcha() で検証すること -->
                    <div class="recaptcha g-recaptcha" data-sitekey="<?= htmlspecialchars(RECAPTCHA_SITE_KEY) ?>"></div>

                    <button class="btn-submit" type="submit" disabled>登録する</button>
                    <p class="form-note">※ メールアドレスでの新規登録は準備中です。</p>
                </form>
            </div>
        </section>

        <!-- 右: ソーシャル登録。動くのは Google のみ -->
        <section>
            <h2 class="col__title">ソーシャルアカウントで新規登録</h2>
            <?php auriga_social_buttons('登録', $googleUrl); ?>
            <p class="social-note">Auriga Labsが許可無くX(Twitter)に投稿することはありません。</p>
            <p class="social-note">X(Twitter)ログインに制限が生じる可能性がございます。他のログイン方法の併用をお願いします。</p>
        </section>
    </div>

    <p class="foot">
        📣 Auriga Labsのアカウントをお持ちの場合は、<a href="<?= htmlspecialchars($loginHref) ?>">ログイン</a> からお入りください。
    </p>
</div>
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
</body>
</html>
    <?php
}
