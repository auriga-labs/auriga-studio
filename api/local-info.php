<?php
/**
 * local-info.php — デプロイ先リポジトリのローカル情報（git）を返す API
 *
 * 「Auriga Studio について」モーダルから読み込み、稼働中の
 * ブランチ・コミット・作業ツリーの状態を表示するために使う。
 * Electron 版では electron-main.js 内の collectLocalInfo() が同じ構造を返す。
 *
 * 認証: 不要（リポジトリで公開済みの情報のみ）
 * 応答: { branch, commit:{hash,short_hash,message,author,email,date}, repository:{root,is_dirty} }
 */

header('Content-Type: application/json; charset=utf-8');

// git はリポジトリルート（このファイルの 1 つ上の階層）で実行する
chdir(dirname(__DIR__));

// git コマンドを実行して出力を返す（失敗時は例外を投げる）
function git($command)
{
  $output = [];
  $returnCode = 0;

  exec("git $command 2>&1", $output, $returnCode);

  if ($returnCode !== 0) {
    throw new RuntimeException(implode("\n", $output));
  }

  return trim(implode("\n", $output));
}

try {
  $data = [
    'branch' => git('branch --show-current'),
    'commit' => [
      'hash'       => git('rev-parse HEAD'),
      'short_hash' => git('rev-parse --short HEAD'),
      'message'    => git('log -1 --pretty=%s'),
      'author'     => git('log -1 --pretty=%an'),
      'email'      => git('log -1 --pretty=%ae'),
      'date'       => git('log -1 --date=iso-strict --pretty=%cd'),
    ],
    'repository' => [
      'root'     => git('rev-parse --show-toplevel'),
      'is_dirty' => git('status --porcelain') !== '',
    ],
  ];

  echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'error'   => true,
    'message' => $e->getMessage(),
  ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}
