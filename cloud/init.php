<?php
/**
 * init.php — Auriga Cloud フォルダの初期化
 *
 * Google ドライブのルート直下に「Auriga Cloud」という名前のフォルダが
 * 無ければ作成する。既にあればそのフォルダ ID を返す。
 *
 * 認証: Authorization: Bearer <access_token>
 * 応答: { ok, folderId, name, created }
 */

require_once __DIR__ . '/drive.php';

$token = require_access_token();

// 既存判定（作成されたかどうかを応答に含めるため先に探す）
$existing = find_auriga_folder($token);
$folderId = $existing ?? ensure_auriga_folder($token);

json_response([
  'ok'       => true,
  'folderId' => $folderId,
  'name'     => AURIGA_FOLDER_NAME,
  'created'  => $existing === null, // 今回新規作成したら true
]);
