<?php
/**
 * ログイン／新規登録／パスワード再設定に共通の見た目。
 * 各ビューが <head> 内で auriga_auth_styles() を呼ぶ。
 */

declare(strict_types=1);

/**
 * ログイン失敗・キャンセルの通知を出す。
 * ログインページは見出しの下、新規登録ページはリード文の下に置く。
 * メッセージが空なら何も出力しない。
 */
function auriga_auth_notice(string $message): void
{
    if ($message === '') {
        return;
    }
    ?>
    <div class="notice-error" role="alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m-1 5h2v7h-2zm0 9h2v2h-2z"/>
        </svg>
        <span><?= htmlspecialchars($message) ?></span>
    </div>
    <?php
}

// 共通の <style> ブロックを出力する
function auriga_auth_styles(): void
{
    ?>
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

        /* ---- フォーム ---- */
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
        .field__hint--info { color: #5a7184; }
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

        /* 補助リンク（「パスワードを忘れた場合」など） */
        .link-sub { display: inline-block; font-size: 13px; color: #1a73e8; margin: 4px 0 16px; }

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
        /* 「送信」のような小さめのボタン */
        .btn-submit--sm { width: auto; padding: 8px 20px; font-size: 14px; }
        .form-note { font-size: 11.5px; color: #8a9096; margin-top: 8px; }

        /* ---- ソーシャルアカウント ---- */
        .social { display: flex; flex-direction: column; gap: 12px; }
        .btn-social {
            position: relative;
            display: flex; align-items: center; justify-content: center;
            width: 100%;
            /* 左右を同じだけ空け、アイコンを絶対配置しても文言が中央に残るようにする */
            padding: 11px 60px;
            font-size: 14.5px; font-weight: 600; font-family: inherit;
            color: #1a1a1a; background: #fff;
            border: 1px solid #cfd4d9; border-radius: 4px;
            text-decoration: none;
            cursor: pointer;
        }
        /* アイコンは行の流れから外して左端に固定し、5つとも縦に揃える。
           ロゴごとに最適なサイズが違う（16〜18px）ので、20px の枠の中央に置く */
        .btn-social__icon {
            position: absolute;
            left: 32px; top: 50%;
            transform: translateY(-50%);
            display: flex; align-items: center; justify-content: center;
            width: 20px; height: 20px;
        }
        .btn-social:hover { background: #f5f6f7; }
        .btn-social:disabled { color: #9aa0a6; background: #fafbfc; cursor: not-allowed; }
        .btn-social:disabled svg { opacity: .45; }
        .btn-social svg { flex: none; }
        .social-note { font-size: 13px; color: #4b5563; margin-top: 16px; }
        .social-note + .social-note { margin-top: 12px; }

        /* ---- フッター ---- */
        .foot { margin-top: 34px; border-top: 1px solid #e3e6e8; padding-top: 18px; font-size: 13.5px; }
        .foot a { color: #1a73e8; }

        .error { font-size: 14px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; }

        /* ログインのキャンセル・失敗を知らせる赤い通知 */
        .notice-error {
            display: flex; align-items: center; gap: 10px;
            font-size: 14px; font-weight: 500;
            color: #fff; background: #d93025;
            border-radius: 4px;
            padding: 12px 16px;
            margin-bottom: 26px;
        }
        .notice-error svg { flex: none; }

        @media (max-width: 720px) {
            .sheet { padding: 28px 20px; }
            .cols { grid-template-columns: 1fr; gap: 28px; }
        }
    </style>
    <?php
}
