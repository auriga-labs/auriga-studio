<?php
/**
 * ダッシュボード (ログイン後のページ)
 */

require_once 'config.php';

session_start();

// 未ログインの場合はトップへ
if (!isset($_SESSION['user'])) {
    header('Location: index.php');
    exit;
}

$user = $_SESSION['user'];
?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ダッシュボード</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background: #f0f4f8;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            padding: 40px;
            width: 400px;
            text-align: center;
        }
        .avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            margin-bottom: 16px;
            border: 3px solid #e5e7eb;
        }
        h1 { font-size: 20px; color: #1a1a2e; margin-bottom: 4px; }
        .email { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
        .info-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
            text-align: left;
            font-size: 14px;
        }
        .info-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #f3f4f6;
        }
        .info-table td:first-child { color: #9ca3af; width: 40%; }
        .info-table td:last-child  { color: #374151; font-weight: 500; }
        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 99px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge.ok  { background: #d1fae5; color: #065f46; }
        .badge.ng  { background: #fee2e2; color: #991b1b; }
        .btn-logout {
            display: inline-block;
            padding: 10px 24px;
            background: #374151;
            color: #fff;
            border-radius: 8px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.15s;
        }
        .btn-logout:hover { background: #1f2937; }
    </style>
</head>
<body>
    <div class="card">
        <img
            src="<?= htmlspecialchars($user['picture']) ?>"
            alt="プロフィール画像"
            class="avatar"
        >
        <h1><?= htmlspecialchars($user['name']) ?></h1>
        <p class="email"><?= htmlspecialchars($user['email']) ?></p>

        <table class="info-table">
            <tr>
                <td>Google ID</td>
                <td><?= htmlspecialchars($user['id']) ?></td>
            </tr>
            <tr>
                <td>メール認証</td>
                <td>
                    <?php if ($user['verified']): ?>
                        <span class="badge ok">✓ 確認済み</span>
                    <?php else: ?>
                        <span class="badge ng">未確認</span>
                    <?php endif; ?>
                </td>
            </tr>
        </table>

        <a href="logout.php" class="btn-logout">ログアウト</a>
    </div>
</body>
</html>
