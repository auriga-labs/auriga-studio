<?php
/**
 * ソーシャルアカウントのボタン列（ログイン／新規登録で共用）。
 *
 * 認可 URL が渡されたプロバイダーはリンク、null のものは disabled のダミーになる。
 * URL の組み立ては oauth-providers.php の auriga_social_login_urls() が行い、
 * config.php のキーがマスク値のままなら null が返る。
 */

declare(strict_types=1);

/**
 * GitHub / Google / X(Twitter) / Apple / LINE のボタンを出力する。
 *
 * @param string                    $verb ボタン文言の動詞。'登録' か 'ログイン'
 * @param array<string, string|null> $urls プロバイダーキー => 認可 URL（null なら押せない）
 */
function auriga_social_buttons(string $verb, array $urls): void
{
    // Apple は HIG で使える文言が決まっており「ログイン」は不可。
    // 「Appleでサインイン」「Appleで登録」「Appleで続ける」から選ぶ。
    $appleVerb = ($verb === 'ログイン') ? 'サインイン' : $verb;
    ?>
    <div class="social">
        <?php auriga_social_button($urls['github'] ?? null, 'GitHubで' . $verb, <<<'SVG'
            <!-- GitHub マーク -->
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
        SVG); ?>

        <?php auriga_social_button($urls['google'] ?? null, 'Googleで' . $verb, <<<'SVG'
            <!-- Google "G" ロゴ -->
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
        SVG); ?>

        <?php auriga_social_button($urls['apple'] ?? null, 'Appleで' . $appleVerb, <<<'SVG'
            <!-- Apple ロゴ -->
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 12.04c-.02-2.29 1.87-3.39 1.95-3.44-1.06-1.55-2.71-1.77-3.3-1.79-1.4-.14-2.74.83-3.46.83-.72 0-1.81-.81-2.98-.79-1.53.02-2.95.89-3.74 2.26-1.6 2.77-.41 6.86 1.14 9.1.76 1.1 1.66 2.33 2.84 2.29 1.14-.05 1.57-.74 2.95-.74 1.38 0 1.77.74 2.98.71 1.23-.02 2.01-1.12 2.76-2.22.87-1.27 1.23-2.5 1.25-2.57-.03-.01-2.4-.92-2.42-3.64M14.77 5.2c.63-.76 1.05-1.82.93-2.87-.9.04-1.99.6-2.64 1.36-.58.67-1.09 1.75-.95 2.78 1 .08 2.03-.51 2.66-1.27"/>
            </svg>
        SVG); ?>

        <?php auriga_social_button($urls['x'] ?? null, 'X(Twitter)で' . $verb, <<<'SVG'
            <!-- X(Twitter) ロゴ -->
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.152h7.594l5.243 6.932zm-1.29 19.5h2.039L6.486 3.24H4.298z"/>
            </svg>
        SVG); ?>

        <?php auriga_social_button($urls['line'] ?? null, 'LINEで' . $verb, <<<'SVG'
            <!-- LINE ロゴ -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#06C755" aria-hidden="true">
                <path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.02 3.55 7.39 8.35 8.03.32.07.77.21.88.49.1.25.07.64.03.89l-.14.85c-.04.25-.2.98.86.53s5.72-3.37 7.8-5.77c1.44-1.58 2.13-3.18 2.13-4.99C22 5.64 17.52 2 12 2M8.1 12.9H6.2c-.28 0-.5-.22-.5-.5V8.6c0-.28.22-.5.5-.5s.5.22.5.5v3.3h1.4c.28 0 .5.22.5.5s-.22.5-.5.5m2.2-.5c0 .28-.22.5-.5.5s-.5-.22-.5-.5V8.6c0-.28.22-.5.5-.5s.5.22.5.5v3.8m4.5 0c0 .22-.14.41-.35.48-.05.02-.1.02-.15.02-.16 0-.31-.07-.4-.2l-1.95-2.65v2.35c0 .28-.22.5-.5.5s-.5-.22-.5-.5V8.6c0-.22.14-.41.34-.48.05-.02.11-.02.16-.02.16 0 .31.08.4.2l1.95 2.66V8.6c0-.28.22-.5.5-.5s.5.22.5.5v3.8m3-2.4c.28 0 .5.22.5.5s-.22.5-.5.5h-1.4v.9h1.4c.28 0 .5.22.5.5s-.22.5-.5.5h-1.9c-.28 0-.5-.22-.5-.5V8.6c0-.28.22-.5.5-.5h1.9c.28 0 .5.22.5.5s-.22.5-.5.5h-1.4v.9h1.4z"/>
            </svg>
        SVG); ?>
    </div>
    <?php
}

/**
 * ボタン 1 個を出力する。
 * 認可 URL があればリンク、無ければ「準備中」の disabled ボタンにする。
 *
 * @param string|null $url   認可 URL
 * @param string      $label ボタン文言
 * @param string      $svg   ロゴの SVG（このファイル内の固定値のみ渡すこと）
 */
function auriga_social_button(?string $url, string $label, string $svg): void
{
    if ($url !== null) {
        ?>
        <a class="btn-social" href="<?= htmlspecialchars($url) ?>">
            <span class="btn-social__icon"><?= $svg ?></span>
            <?= htmlspecialchars($label) ?>
        </a>
        <?php
        return;
    }
    ?>
    <button class="btn-social" type="button" disabled title="準備中">
        <span class="btn-social__icon"><?= $svg ?></span>
        <?= htmlspecialchars($label) ?>
    </button>
    <?php
}
