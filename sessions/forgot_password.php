<?php
/**
 * パスワード再設定メールの送信ページ（/sessions/forgot_password）
 * 中身は oauth/forgot-password-view.php。ここは入口だけを持つ。
 */

declare(strict_types=1);

require_once __DIR__ . '/../oauth/auth-page.php';

auriga_render_forgot_password_page();
