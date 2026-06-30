<?php
/**
 * list.php — Auriga Cloud のファイル一覧を取得して返す
 *
 * 「Auriga Cloud」フォルダ内（ゴミ箱を除く）のファイル一覧を返す。
 * フォルダが無ければ作成してから空一覧を返す。
 *
 * 認証: Authorization: Bearer <access_token>
 * 応答: { ok, folderId, files:[{id,name,size,mimeType,modifiedTime,createdTime}] }
 */

require_once __DIR__ . '/drive.php';

$token    = require_access_token();
$folderId = ensure_auriga_folder($token);

$q = "'" . drive_escape($folderId) . "' in parents and trashed = false";
$url = DRIVE_API . '/files?' . http_build_query([
  'q'        => $q,
  'fields'   => 'files(id,name,size,mimeType,modifiedTime,createdTime)',
  'orderBy'  => 'modifiedTime desc',
  'pageSize' => 1000,
  'spaces'   => 'drive',
]);

$res = drive_curl('GET', $url, $token);
if ($res['status'] !== 200) {
  json_error('一覧取得に失敗しました。', $res['status']);
}
$data = json_decode($res['body'], true);

json_response([
  'ok'       => true,
  'folderId' => $folderId,
  'files'    => $data['files'] ?? [],
]);
