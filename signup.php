<?php
/**
 * 新規登録ページ（/signup?redirect_to=%2F）
 * 認証は Google OAuth のみなので認可フローはログインと同じ。文言だけ変える。
 */

declare(strict_types=1);

require_once __DIR__ . '/oauth/auth-page.php';

auriga_render_auth_page('signup');
