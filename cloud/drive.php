<?php
/**
 * Auriga Cloud 共通処理
 *
 * Google ドライブのルート直下にある「Auriga Cloud」フォルダを
 * クラウド保存先として扱うためのヘルパー群。
 *
 * アクセストークンはアプリ（レンダラー）が `Authorization: Bearer <token>`
 * で送ってくる前提。Cookie を使わず Bearer トークンのみで認証する。
 */

// ── CORS / プリフライト ──────────────────────────────────────────────
// Electron レンダラーからのクロスオリジン要求を許可する。
// Cookie を使わず Bearer トークンのみで認証するため Origin は * で良い。
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  http_response_code(204);
  exit;
}

// Auriga Cloud フォルダ名（Google ドライブのルート直下に作る）
const AURIGA_FOLDER_NAME = 'Auriga Cloud';
const DRIVE_API    = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/**
 * JSON を返して終了する
 */
function json_response($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=UTF-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

/**
 * エラー JSON を返して終了する
 */
function json_error(string $message, int $status = 400): void {
  json_response(['ok' => false, 'error' => $message], $status);
}

/**
 * Authorization ヘッダからアクセストークンを取り出す。
 * 無ければ 401 で終了する。
 */
function require_access_token(): string {
  $header = '';
  // 実行環境によりヘッダ取得方法が異なるため両対応する
  if (function_exists('getallheaders')) {
    foreach (getallheaders() as $k => $v) {
      if (strcasecmp($k, 'Authorization') === 0) { $header = $v; break; }
    }
  }
  if ($header === '') {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
  }
  if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) {
    json_error('アクセストークンがありません。', 401);
  }
  return trim($m[1]);
}

/**
 * Drive API のクエリ文字列内で使う値をエスケープする。
 * （シングルクォートとバックスラッシュを退避する）
 */
function drive_escape(string $value): string {
  return str_replace(["\\", "'"], ["\\\\", "\\'"], $value);
}

/**
 * Drive API を呼ぶ汎用 curl ヘルパー。
 *
 * @param string $method  HTTP メソッド
 * @param string $url     リクエスト URL
 * @param string $token   アクセストークン
 * @param array  $opts    headers / body / stream(true で本文を直接出力)
 * @return array{status:int, body:string}
 */
function drive_curl(string $method, string $url, string $token, array $opts = []): array {
  $ch = curl_init($url);
  $headers = $opts['headers'] ?? [];
  $headers[] = 'Authorization: Bearer ' . $token;
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
  ]);
  if (isset($opts['body'])) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
  }
  // ダウンロードなど本文をそのままブラウザへ流したい場合
  if (!empty($opts['stream'])) {
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
  }
  $body   = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err    = curl_error($ch);
  curl_close($ch);
  if ($err) {
    json_error('Drive API 通信エラー: ' . $err, 502);
  }
  return ['status' => $status, 'body' => is_string($body) ? $body : ''];
}

/**
 * Google ドライブのルート直下から「Auriga Cloud」フォルダを探す。
 *
 * @return string|null 見つかればフォルダ ID、無ければ null
 */
function find_auriga_folder(string $token): ?string {
  $name = drive_escape(AURIGA_FOLDER_NAME);
  $q = "name = '{$name}' and mimeType = 'application/vnd.google-apps.folder' "
     . "and 'root' in parents and trashed = false";
  $url = DRIVE_API . '/files?' . http_build_query([
    'q'      => $q,
    'fields' => 'files(id,name)',
    'spaces' => 'drive',
  ]);
  $res = drive_curl('GET', $url, $token);
  if ($res['status'] !== 200) {
    json_error('フォルダ検索に失敗しました。', $res['status']);
  }
  $data = json_decode($res['body'], true);
  return $data['files'][0]['id'] ?? null;
}

/**
 * 「Auriga Cloud」フォルダを取得する。無ければ作成する。
 *
 * @return string フォルダ ID
 */
function ensure_auriga_folder(string $token): string {
  $id = find_auriga_folder($token);
  if ($id !== null) {
    return $id;
  }
  $meta = json_encode([
    'name'     => AURIGA_FOLDER_NAME,
    'mimeType' => 'application/vnd.google-apps.folder',
    'parents'  => ['root'],
  ], JSON_UNESCAPED_UNICODE);
  $res = drive_curl('POST', DRIVE_API . '/files?fields=id', $token, [
    'headers' => ['Content-Type: application/json; charset=UTF-8'],
    'body'    => $meta,
  ]);
  if ($res['status'] !== 200 && $res['status'] !== 201) {
    json_error('フォルダ作成に失敗しました。', $res['status']);
  }
  $data = json_decode($res['body'], true);
  if (empty($data['id'])) {
    json_error('フォルダ作成のレスポンスが不正です。', 502);
  }
  return $data['id'];
}
