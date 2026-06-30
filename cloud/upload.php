<?php
/**
 * upload.php — ファイルを Auriga Cloud にアップロードする
 *
 * multipart/form-data で送られた `file`（必須）を「Auriga Cloud」フォルダへ
 * 保存する。`name`（任意）でドライブ上の表示名を指定できる。
 *
 * 認証: Authorization: Bearer <access_token>
 * 応答: { ok, file:{id,name,size,mimeType,modifiedTime} }
 */

require_once __DIR__ . '/drive.php';

$token = require_access_token();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  json_error('POST で送信してください。', 405);
}
if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  json_error('アップロードファイルがありません。', 400);
}

$folderId = ensure_auriga_folder($token);

$tmpPath = $_FILES['file']['tmp_name'];
$name    = $_POST['name'] ?? $_FILES['file']['name'];
$mime    = $_FILES['file']['type'] ?: 'application/octet-stream';
$content = file_get_contents($tmpPath);
if ($content === false) {
  json_error('アップロードファイルの読み込みに失敗しました。', 500);
}

// Drive の multipart アップロード（メタ情報 + 本体を 1 リクエストで送る）
$boundary = 'auriga' . bin2hex(random_bytes(8));
$meta = json_encode([
  'name'    => $name,
  'parents' => [$folderId],
], JSON_UNESCAPED_UNICODE);

$body  = "--{$boundary}\r\n";
$body .= "Content-Type: application/json; charset=UTF-8\r\n\r\n";
$body .= $meta . "\r\n";
$body .= "--{$boundary}\r\n";
$body .= "Content-Type: {$mime}\r\n\r\n";
$body .= $content . "\r\n";
$body .= "--{$boundary}--";

$url = DRIVE_UPLOAD . '/files?' . http_build_query([
  'uploadType' => 'multipart',
  'fields'     => 'id,name,size,mimeType,modifiedTime',
]);
$res = drive_curl('POST', $url, $token, [
  'headers' => ["Content-Type: multipart/related; boundary={$boundary}"],
  'body'    => $body,
]);
if ($res['status'] !== 200 && $res['status'] !== 201) {
  json_error('アップロードに失敗しました。', $res['status']);
}

json_response([
  'ok'   => true,
  'file' => json_decode($res['body'], true),
]);
