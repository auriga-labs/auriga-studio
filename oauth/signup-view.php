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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', Meiryo, sans-serif;
            background: #f5f6f7;
            color: #1a1a1a;
            line-height: 1.6;
            padding: 32px 16px;
        }
        .sheet {
            background: #fff;
            border-radius: 6px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, .08);
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
        }
        .sheet__title { font-size: 27px; font-weight: 700; margin-bottom: 14px; }
        .sheet__lead { font-size: 17px; font-weight: 700; margin-bottom: 30px; }

        .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; align-items: start; }
        .col__title { font-size: 15px; font-weight: 700; margin-bottom: 16px; }

        /* ---- 左: メールアドレスで新規登録 ---- */
        .form-box {
            border: 1px solid #e3e6e8;
            border-radius: 4px;
            background: #fafbfc;
            padding: 20px;
        }
        .field { margin-bottom: 16px; }
        .field__label { font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 7px; }
        .badge-req {
            font-size: 11px; font-weight: 700; color: #c2185b;
            background: #fde8ee; border-radius: 3px; padding: 1px 6px;
        }
        .field__hint { font-size: 11.5px; color: #8a9096; margin: 4px 0 6px; }
        .field__hint--warn { color: #c2185b; }
        .field__input {
            width: 100%;
            padding: 9px 12px;
            font-size: 14px;
            font-family: inherit;
            color: #1a1a1a;
            background: #fff;
            border: 1px solid #cfd4d9;
            border-radius: 4px;
        }
        .field__input:focus { outline: 2px solid #9db8d2; outline-offset: -1px; }
        .field__input::placeholder { color: #b3b9bf; }

        .agree { font-size: 13.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 7px; }
        .agree a { color: #1a1a1a; }

        /* reCAPTCHA ウィジェットの置き場所（中身は Google の iframe） */
        .recaptcha { margin: 16px 0; }

        .btn-submit {
            width: 100%;
            padding: 11px 16px;
            font-size: 15px; font-weight: 700; font-family: inherit;
            color: #fff; background: #2e7d32;
            border: none; border-radius: 4px;
            cursor: pointer;
        }
        .btn-submit:hover { background: #276b2b; }
        .btn-submit:disabled { background: #9bbd9d; cursor: not-allowed; }
        .form-note { font-size: 11.5px; color: #8a9096; margin-top: 8px; }

        /* ---- 右: ソーシャルアカウントで新規登録 ---- */
        .social { display: flex; flex-direction: column; gap: 12px; }
        .btn-social {
            display: flex; align-items: center; justify-content: center; gap: 10px;
            width: 100%;
            padding: 11px 16px;
            font-size: 14.5px; font-weight: 600; font-family: inherit;
            color: #1a1a1a; background: #fff;
            border: 1px solid #cfd4d9; border-radius: 4px;
            text-decoration: none;
            cursor: pointer;
        }
        .btn-social:hover { background: #f5f6f7; }
        .btn-social:disabled { color: #9aa0a6; background: #fafbfc; cursor: not-allowed; }
        .btn-social:disabled svg { opacity: .45; }
        .btn-social svg { flex: none; }
        .social-note { font-size: 13px; color: #4b5563; margin-top: 16px; }
        .social-note + .social-note { margin-top: 12px; }

        /* ---- フッター ---- */
        .foot { margin-top: 34px; border-top: 1px solid #e3e6e8; padding-top: 18px; font-size: 13.5px; }
        .foot a { color: #1a1a1a; }

        @media (max-width: 720px) {
            .sheet { padding: 28px 20px; }
            .cols { grid-template-columns: 1fr; gap: 28px; }
        }
    </style>
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
            <div class="social">
                <button class="btn-social" type="button" disabled title="準備中">
                    <!-- GitHub マーク -->
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    GitHubで登録
                </button>

                <?php if ($googleUrl !== null): ?>
                    <a class="btn-social" href="<?= htmlspecialchars($googleUrl) ?>">
                <?php else: ?>
                    <button class="btn-social" type="button" disabled title="準備中">
                <?php endif; ?>
                    <!-- Google "G" ロゴ -->
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                        <path fill="none" d="M0 0h48v48H0z"/>
                    </svg>
                    Googleで登録
                <?= $googleUrl !== null ? '</a>' : '</button>' ?>

                <button class="btn-social" type="button" disabled title="準備中">
                    <!-- X(Twitter) ロゴ -->
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.152h7.594l5.243 6.932zm-1.29 19.5h2.039L6.486 3.24H4.298z"/>
                    </svg>
                    X(Twitter)で登録
                </button>
            </div>

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
