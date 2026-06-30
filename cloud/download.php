<?php
/**
 * download.php — Auriga Cloud のファイルを取得する
 *
 * GET ?id=<fileId> で指定したファイルの本体を返す。タイムラインで
 * そのまま使えるよう、元のファイル名と MIME を付けてストリーミングする。
 *
 * 認証: Authorization: Bearer <access_token>
 */

require_once __DIR__ . '/drive.php';

$token  = require_access_token();
$fileId = $_GET['id'] ?? $_GET['fileId'] ?? '';
if ($fileId === '') {
  json_error('ファイル ID を指定してください。', 400);
}

// まずメタ情報（名前・MIME・サイズ）を取得する
$metaUrl = DRIVE_API . '/files/' . rawurlencode($fileId) . '?' . http_build_query([
  'fields' => 'id,name,mimeType,size',
]);
$metaRes = drive_curl('GET', $metaUrl, $token);
if ($metaRes['status'] !== 200) {
  json_error('ファイルが見つかりません。', $metaRes['status']);
}
$meta = json_decode($metaRes['body'], true);

// ヘッダを付けて本体をストリーミングで返す
header('Content-Type: ' . ($meta['mimeType'] ?: 'application/octet-stream'));
if (!empty($meta['size'])) {
  header('Content-Length: ' . $meta['size']);
}
// 日本語ファイル名にも対応するため RFC 5987 形式で指定する
header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($meta['name']));

$mediaUrl = DRIVE_API . '/files/' . rawurlencode($fileId) . '?alt=media';
// stream オプションで Drive の応答本文を直接ブラウザへ流す
drive_curl('GET', $mediaUrl, $token, ['stream' => true]);
exit;
