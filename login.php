<?php
/**
 * ログインページ（/login?redirect_to=%2F）
 * 中身は oauth/auth-page.php と共通。ここは入口だけを持つ。
 */

declare(strict_types=1);

require_once __DIR__ . '/oauth/auth-page.php';

auriga_render_auth_page('login');
