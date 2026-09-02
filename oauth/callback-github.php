<?php
/**
 * GitHub OAuth コールバックハンドラ
 * GitHub がこのページにリダイレクトしてくる
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/oauth-providers.php';
require_once __DIR__ . '/callback-handler.php';

auriga_handle_oauth_callback(new GitHubOAuth());
