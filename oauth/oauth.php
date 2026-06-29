<?php
/**
 * GoogleOAuth クラス
 * Google OAuth2.0 フローを管理する
 */

class GoogleOAuth
{
    private const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private const USER_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';

    /**
     * Googleログイン用の認可URLを生成する
     * CSRF対策としてstateパラメータをセッションに保存
     */
    public function getAuthorizationUrl(): string
    {
        $state = bin2hex(random_bytes(16));
        $_SESSION['oauth_state'] = $state;

        // スコープは config.php の GOOGLE_SCOPES から組み立てる（未定義なら最小構成）
        $scope = defined('GOOGLE_SCOPES')
            ? implode(' ', GOOGLE_SCOPES)
            : 'openid email profile';

        $params = http_build_query([
            'client_id'     => GOOGLE_CLIENT_ID,
            'redirect_uri'  => GOOGLE_REDIRECT_URI,
            'response_type' => 'code',
            'scope'         => $scope,
            'state'         => $state,
            'access_type'   => 'offline',   // refresh_tokenを取得する場合
            'prompt'        => 'consent', // ← 'select_account'から変更（refresh_token再取得のため）
        ]);

        return self::AUTH_URL . '?' . $params;
    }

    /**
     * 認可コードをアクセストークンに交換する
     *
     * @param  string $code Googleから受け取った認可コード
     * @return array        トークン情報
     * @throws RuntimeException
     */
    public function fetchTokens(string $code): array
    {
        $response = $this->post(self::TOKEN_URL, [
            'code'          => $code,
            'client_id'     => GOOGLE_CLIENT_ID,
            'client_secret' => GOOGLE_CLIENT_SECRET,
            'redirect_uri'  => GOOGLE_REDIRECT_URI,
            'grant_type'    => 'authorization_code',
        ]);

        if (isset($response['error'])) {
            throw new RuntimeException('トークン取得エラー: ' . $response['error_description']);
        }

        return $response;
    }

    /**
     * アクセストークンを使ってユーザー情報を取得する
     *
     * @param  string $accessToken
     * @return array  ユーザー情報 (sub, email, name, picture, ...)
     * @throws RuntimeException
     */
    public function fetchUserInfo(string $accessToken): array
    {
        $ch = curl_init(self::USER_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ["Authorization: Bearer $accessToken"],
        ]);
        $body = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($err) {
            throw new RuntimeException('ユーザー情報取得エラー: ' . $err);
        }

        $user = json_decode($body, true);

        if (isset($user['error'])) {
            throw new RuntimeException('ユーザー情報エラー: ' . $user['error']);
        }

        return $user;
    }

    /**
     * POSTリクエストを送信するヘルパー
     */
    private function post(string $url, array $data): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($data),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $body = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($err) {
            throw new RuntimeException('リクエストエラー: ' . $err);
        }

        return json_decode($body, true);
    }
}
