<?php
/**
 * ログインページ（/login）の見た目。
 *
 * ⚠ 現時点ではメールアドレスでのログインと GitHub / X(Twitter) はダミー。
 *    ユーザー DB が無く、GitHub / X の OAuth アプリも未作成のため、動くのは
 *    Google の認可リンクだけ。
 */

declare(strict_types=1);

require_once __DIR__ . '/auth-styles.php';
require_once __DIR__ . '/social-buttons.php';

/**
 * ログインページを出力する。
 *
 * @param string      $redirectTo 新規登録・パスワード再設定へ引き継ぐ戻り先
 * @param string|null $googleUrl  Google 認可 URL。null なら Google も押せない（未設定環境）
 * @param string      $message    利用不可の理由（$googleUrl が null のとき表示）
 */
function auriga_render_login_html(string $redirectTo, ?string $googleUrl, string $message = ''): void
{
    $signupHref = '/signup?redirect_to=' . rawurlencode($redirectTo);
    $forgotHref = '/sessions/forgot_password?redirect_to=' . rawurlencode($redirectTo);

    header('Content-Type: text/html; charset=UTF-8');
    ?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ログイン | Auriga Studio</title>
    <link rel="icon" href="/favicon.svg">
    <?php auriga_auth_styles(); ?>
</head>
<body>
<div class="sheet">
    <h1 class="sheet__title">Auriga Labs にログイン</h1>

    <?php if ($googleUrl === null && $message !== ''): ?>
        <p class="error" style="margin-bottom:24px"><?= htmlspecialchars($message) ?></p>
    <?php endif; ?>

    <div class="cols">
        <!-- 左: メールアドレスでログイン（ダミー。ユーザー DB が無いので送信先を持たない） -->
        <section>
            <h2 class="col__title">メールアドレスでログイン</h2>
            <div class="form-box">
                <form onsubmit="return false;">
                    <div class="field">
                        <label class="field__label" for="liUser">ユーザー名 または メールアドレス <span class="badge-req">必須</span></label>
                        <input class="field__input" id="liUser" type="text" placeholder="ユーザー名 または メールアドレス" autocomplete="username" style="margin-top:6px">
                    </div>
                    <div class="field">
                        <label class="field__label" for="liPass">パスワード <span class="badge-req">必須</span></label>
                        <input class="field__input" id="liPass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top:6px">
                    </div>

                    <a class="link-sub" href="<?= htmlspecialchars($forgotHref) ?>">パスワードを忘れた場合</a>

                    <button class="btn-submit" type="submit" disabled>Auriga Labs にログイン</button>
                    <p class="form-note">※ メールアドレスでのログインは準備中です。</p>
                </form>
            </div>
        </section>

        <!-- 右: ソーシャルログイン。動くのは Google のみ -->
        <section>
            <h2 class="col__title">ソーシャルアカウントでログイン</h2>
            <?php auriga_social_buttons('ログイン', $googleUrl); ?>
            <p class="social-note">X(Twitter)ログインに制限が生じる可能性がございます。他のログイン方法の併用をお願いします。</p>
        </section>
    </div>

    <p class="foot">
        📣 Auriga Labsのアカウントをお持ちでない場合は、<a href="<?= htmlspecialchars($signupHref) ?>">新規登録</a>からアカウントを作成してください。
    </p>
</div>
</body>
</html>
    <?php
}
