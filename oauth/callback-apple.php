<?php
/**
 * Apple OAuth コールバックハンドラ
 *
 * ⚠ scope に name/email を含めているため response_mode=form_post になり、
 *   Apple は GET ではなく POST でこのページを呼ぶ。
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/oauth-providers.php';
require_once __DIR__ . '/callback-handler.php';

auriga_handle_oauth_callback(new AppleOAuth());
