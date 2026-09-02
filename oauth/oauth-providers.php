<?php
/**
 * Google 以外のソーシャルログイン（GitHub / X(Twitter) / Apple / LINE）の OAuth フロー。
 *
 * Google は歴史的な経緯で oauth.php の GoogleOAuth が持っている。
 * ここではそれ以外を共通の基底クラスにまとめ、コールバックの処理を
 * callback-handler.php で 1 本化できるようにしている。
 *
 * どのプロバイダーも fetchUserInfo() は同じ形の配列を返す:
 *   ['id' => string, 'email' => string, 'name' => string,
 *    'picture' => string, 'verified' => bool]
 */

declare(strict_types=1);

require_once __DIR__ . '/oauth.php';

/**
 * 認可コードフローの共通部分。
 * プロバイダーごとの差分（PKCE・Basic 認証・追加パラメータ）は
 * 子クラスでフックを上書きして表現する。
 */
abstract class AurigaOAuthProvider
{
    /** セッションキーや state に使う識別子。'github' など */
    abstract public function key(): string;

    /** エラーメッセージに出す表示名 */
    abstract public function label(): string;

    abstract protected function authEndpoint(): string;
    abstract protected function tokenEndpoint(): string;
    abstract protected function clientId(): string;
    abstract protected function clientSecret(): string;
    abstract protected function redirectUri(): string;
    abstract protected function scopes(): array;

    /**
     * トークンからユーザー情報を取り出し、共通の形に正規化する。
     *
     * @param  array $tokens fetchTokens() の戻り値
     * @return array id / email / name / picture / verified
     */
    abstract public function fetchUserInfo(array $tokens): array;

    /** PKCE(RFC7636) を使うか。X は必須 */
    protected function usesPkce(): bool
    {
        return false;
    }

    /** トークン交換で client_secret を Basic 認証ヘッダーに載せるか */
    protected function usesBasicAuth(): bool
    {
        return false;
    }

    /** 認可 URL に足す追加パラメータ */
    protected function extraAuthParams(): array
    {
        return [];
    }

    /**
     * 認可 URL を生成する。
     * CSRF 対策の state（と PKCE の code_verifier）はセッションに預ける。
     */
    public function getAuthorizationUrl(): string
    {
        $state = bin2hex(random_bytes(16));
        $_SESSION['oauth_state_' . $this->key()] = $state;

        $params = [
            'client_id'     => $this->clientId(),
            'redirect_uri'  => $this->redirectUri(),
            'response_type' => 'code',
            'scope'         => implode(' ', $this->scopes()),
            'state'         => $state,
        ];

        if ($this->usesPkce()) {
            // verifier はコールバックでトークン交換に使うので保存しておく
            $verifier = self::b64url(random_bytes(48));
            $_SESSION['oauth_verifier_' . $this->key()] = $verifier;

            $params['code_challenge']        = self::b64url(hash('sha256', $verifier, true));
            $params['code_challenge_method'] = 'S256';
        }

        // 同じキーがあれば $params 側を優先する
        return $this->authEndpoint() . '?' . http_build_query($params + $this->extraAuthParams());
    }

    /**
     * 認可コードをアクセストークンに交換する。
     *
     * @throws RuntimeException
     */
    public function fetchTokens(string $code): array
    {
        $data = [
            'grant_type'   => 'authorization_code',
            'code'         => $code,
            'redirect_uri' => $this->redirectUri(),
            'client_id'    => $this->clientId(),
        ];

        $headers = [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',   // GitHub は付けないとフォーム形式で返してくる
        ];

        if ($this->usesBasicAuth()) {
            $headers[] = 'Authorization: Basic '
                . base64_encode($this->clientId() . ':' . $this->clientSecret());
        } else {
            $data['client_secret'] = $this->clientSecret();
        }

        if ($this->usesPkce()) {
            $sessionKey = 'oauth_verifier_' . $this->key();
            $data['code_verifier'] = $_SESSION[$sessionKey] ?? '';
            unset($_SESSION[$sessionKey]);   // 使い捨て
        }

        $response = self::httpPost($this->tokenEndpoint(), $data, $headers);

        if (isset($response['error'])) {
            throw new RuntimeException(
                'トークン取得エラー: ' . ($response['error_description'] ?? $response['error'])
            );
        }
        if (empty($response['access_token']) && empty($response['id_token'])) {
            throw new RuntimeException('トークンを取得できませんでした。');
        }

        return $response;
    }

    // ── 共通ヘルパー ────────────────────────────────────────────────────

    /** POST して JSON をデコードする */
    protected static function httpPost(string $url, array $data, array $headers = []): array
    {
        return self::request($url, [
            CURLOPT_POST       => true,
            CURLOPT_POSTFIELDS => http_build_query($data),
            CURLOPT_HTTPHEADER => $headers,
        ]);
    }

    /** GET して JSON をデコードする */
    protected static function httpGet(string $url, array $headers = []): array
    {
        return self::request($url, [CURLOPT_HTTPHEADER => $headers]);
    }

    private static function request(string $url, array $options): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, $options + [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            // GitHub API は User-Agent が無いと 403 を返す
            CURLOPT_USERAGENT      => 'Auriga-Studio',
        ]);
        $body = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($err) {
            throw new RuntimeException('リクエストエラー: ' . $err);
        }

        $decoded = json_decode((string) $body, true);

        return is_array($decoded) ? $decoded : [];
    }

    /** base64url エンコード（パディング無し） */
    protected static function b64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /**
     * JWT のペイロードを取り出す。
     * トークンエンドポイントから TLS 越しに直接受け取ったものだけに使うこと
     * （フロントチャネル経由の JWT は署名検証が別途必要）。
     */
    protected static function decodeJwtPayload(string $jwt): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new RuntimeException('id_token の形式が不正です。');
        }

        $b64  = strtr($parts[1], '-_', '+/');
        $b64 .= str_repeat('=', (4 - strlen($b64) % 4) % 4);

        $claims = json_decode((string) base64_decode($b64, true), true);
        if (!is_array($claims)) {
            throw new RuntimeException('id_token を読み取れませんでした。');
        }

        return $claims;
    }
}

/**
 * GitHub OAuth App。
 * Settings → Developer settings → OAuth Apps で作成する。
 */
class GitHubOAuth extends AurigaOAuthProvider
{
    public function key(): string   { return 'github'; }
    public function label(): string { return 'GitHub'; }

    protected function authEndpoint(): string  { return 'https://github.com/login/oauth/authorize'; }
    protected function tokenEndpoint(): string { return 'https://github.com/login/oauth/access_token'; }
    protected function clientId(): string      { return GITHUB_CLIENT_ID; }
    protected function clientSecret(): string  { return GITHUB_CLIENT_SECRET; }
    protected function redirectUri(): string   { return GITHUB_REDIRECT_URI; }
    protected function scopes(): array         { return GITHUB_SCOPES; }

    public function fetchUserInfo(array $tokens): array
    {
        $auth = ['Authorization: Bearer ' . ($tokens['access_token'] ?? '')];
        $user = self::httpGet('https://api.github.com/user', $auth);

        if (!isset($user['id'])) {
            throw new RuntimeException('ユーザー情報取得エラー: ' . ($user['message'] ?? '不明なエラー'));
        }

        // 公開できるのは検証済みアドレスだけなので、/user が返した時点で verified 扱いでよい
        $email    = $user['email'] ?? null;
        $verified = $email !== null;

        // プロフィールでメールを非公開にしていると null になるため別途取得する
        if ($email === null) {
            foreach (self::httpGet('https://api.github.com/user/emails', $auth) as $row) {
                if (is_array($row) && !empty($row['primary'])) {
                    $email    = $row['email'] ?? null;
                    $verified = (bool) ($row['verified'] ?? false);
                    break;
                }
            }
        }

        return [
            'id'       => (string) $user['id'],
            'email'    => (string) ($email ?? ''),
            'name'     => (string) ($user['name'] ?? $user['login'] ?? ''),
            'picture'  => (string) ($user['avatar_url'] ?? ''),
            'verified' => $verified,
        ];
    }
}

/**
 * X(Twitter) OAuth 2.0。
 * Developer Portal の User authentication settings で
 * Confidential client（Web App）として作成する。
 *
 * ⚠ API v2 はメールアドレスを返さないため email は常に空になる。
 */
class XOAuth extends AurigaOAuthProvider
{
    public function key(): string   { return 'x'; }
    public function label(): string { return 'X(Twitter)'; }

    protected function authEndpoint(): string  { return 'https://x.com/i/oauth2/authorize'; }
    protected function tokenEndpoint(): string { return 'https://api.x.com/2/oauth2/token'; }
    protected function clientId(): string      { return X_CLIENT_ID; }
    protected function clientSecret(): string  { return X_CLIENT_SECRET; }
    protected function redirectUri(): string   { return X_REDIRECT_URI; }
    protected function scopes(): array         { return X_SCOPES; }

    protected function usesPkce(): bool      { return true; }   // X は PKCE 必須
    protected function usesBasicAuth(): bool { return true; }

    public function fetchUserInfo(array $tokens): array
    {
        $response = self::httpGet(
            'https://api.x.com/2/users/me?user.fields=profile_image_url',
            ['Authorization: Bearer ' . ($tokens['access_token'] ?? '')]
        );

        $user = $response['data'] ?? null;
        if (!is_array($user) || !isset($user['id'])) {
            throw new RuntimeException('ユーザー情報取得エラー: ' . ($response['title'] ?? '不明なエラー'));
        }

        // 既定は 48px の _normal なので、大きい画像に差し替える
        $picture = str_replace('_normal.', '_400x400.', (string) ($user['profile_image_url'] ?? ''));

        return [
            'id'       => (string) $user['id'],
            'email'    => '',      // X はメールを提供しない
            'name'     => (string) ($user['name'] ?? $user['username'] ?? ''),
            'picture'  => $picture,
            'verified' => false,
        ];
    }
}

/**
 * Sign in with Apple。
 *
 * client_secret は固定値ではなく、Team ID / Key ID / .p8 秘密鍵から
 * ES256 で署名した JWT を毎回生成する。
 */
class AppleOAuth extends AurigaOAuthProvider
{
    public function key(): string   { return 'apple'; }
    public function label(): string { return 'Apple'; }

    protected function authEndpoint(): string  { return 'https://appleid.apple.com/auth/authorize'; }
    protected function tokenEndpoint(): string { return 'https://appleid.apple.com/auth/token'; }
    protected function clientId(): string      { return APPLE_CLIENT_ID; }
    protected function redirectUri(): string   { return APPLE_REDIRECT_URI; }
    protected function scopes(): array         { return APPLE_SCOPES; }

    /** scope に name/email を含めるとコールバックが POST になる */
    protected function extraAuthParams(): array
    {
        return ['response_mode' => 'form_post'];
    }

    /**
     * client_secret にあたる JWT を組み立てる。
     * 有効期限は最長 6 か月だが、毎リクエスト作り直すので短くてよい。
     */
    protected function clientSecret(): string
    {
        if (!is_readable(APPLE_PRIVATE_KEY_PATH)) {
            throw new RuntimeException('Appleの秘密鍵(.p8)が読めません: ' . APPLE_PRIVATE_KEY_PATH);
        }

        $privateKey = openssl_pkey_get_private((string) file_get_contents(APPLE_PRIVATE_KEY_PATH));
        if ($privateKey === false) {
            throw new RuntimeException('Appleの秘密鍵を読み込めませんでした。');
        }

        $now = time();
        $header  = ['alg' => 'ES256', 'kid' => APPLE_KEY_ID, 'typ' => 'JWT'];
        $payload = [
            'iss' => APPLE_TEAM_ID,
            'iat' => $now,
            'exp' => $now + 3600,
            'aud' => 'https://appleid.apple.com',
            'sub' => APPLE_CLIENT_ID,
        ];

        $input = self::b64url((string) json_encode($header))
               . '.' . self::b64url((string) json_encode($payload));

        $der = '';
        if (!openssl_sign($input, $der, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Appleのclient_secretに署名できませんでした。');
        }

        return $input . '.' . self::b64url(self::ecdsaDerToRaw($der));
    }

    public function fetchUserInfo(array $tokens): array
    {
        $claims = self::decodeJwtPayload((string) ($tokens['id_token'] ?? ''));

        // 念のため発行元と宛先だけ突き合わせる
        if (($claims['iss'] ?? '') !== 'https://appleid.apple.com'
            || ($claims['aud'] ?? '') !== APPLE_CLIENT_ID) {
            throw new RuntimeException('id_tokenの検証に失敗しました。');
        }

        // 氏名は初回認可時に POST の user フィールドで一度だけ返る。
        // ここで取り逃すと二度と取得できないので、DB を作ったら必ず保存すること。
        $name = '';
        if (!empty($_POST['user'])) {
            $posted = json_decode((string) $_POST['user'], true);
            $parts  = is_array($posted) ? ($posted['name'] ?? []) : [];
            $name   = trim(($parts['lastName'] ?? '') . ' ' . ($parts['firstName'] ?? ''));
        }

        $email = (string) ($claims['email'] ?? '');

        return [
            'id'       => (string) ($claims['sub'] ?? ''),
            'email'    => $email,
            'name'     => $name !== '' ? $name : $email,   // Apple はプロフィール名を持たない
            'picture'  => '',                              // Apple はアイコンを提供しない
            'verified' => filter_var($claims['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    /**
     * OpenSSL が返す DER 形式の ECDSA 署名を、JWS が求める R||S の 64 バイトへ変換する。
     */
    private static function ecdsaDerToRaw(string $der): string
    {
        $pos = 0;
        if (ord($der[$pos++]) !== 0x30) {
            throw new RuntimeException('署名の形式が不正です。');
        }

        $length = ord($der[$pos++]);
        if ($length > 0x80) {
            $pos += $length - 0x80;   // 長さフィールドが複数バイトなら読み飛ばす
        }

        $readInteger = static function () use ($der, &$pos): string {
            if (ord($der[$pos++]) !== 0x02) {
                throw new RuntimeException('署名の形式が不正です。');
            }
            $size  = ord($der[$pos++]);
            $value = substr($der, $pos, $size);
            $pos  += $size;

            // 先頭の 0x00 パディングを外して 32 バイトに揃える
            return str_pad(ltrim($value, "\x00"), 32, "\x00", STR_PAD_LEFT);
        };

        return $readInteger() . $readInteger();
    }
}

/**
 * LINE Login。
 * LINE Developers Console の LINE Login チャネルで作成する。
 */
class LineOAuth extends AurigaOAuthProvider
{
    public function key(): string   { return 'line'; }
    public function label(): string { return 'LINE'; }

    protected function authEndpoint(): string  { return 'https://access.line.me/oauth2/v2.1/authorize'; }
    protected function tokenEndpoint(): string { return 'https://api.line.me/oauth2/v2.1/token'; }
    protected function clientId(): string      { return LINE_CLIENT_ID; }
    protected function clientSecret(): string  { return LINE_CLIENT_SECRET; }
    protected function redirectUri(): string   { return LINE_REDIRECT_URI; }
    protected function scopes(): array         { return LINE_SCOPES; }

    /** openid を使うので nonce を添える */
    protected function extraAuthParams(): array
    {
        $nonce = bin2hex(random_bytes(16));
        $_SESSION['oauth_nonce_line'] = $nonce;

        return ['nonce' => $nonce];
    }

    public function fetchUserInfo(array $tokens): array
    {
        $profile = self::httpGet(
            'https://api.line.me/v2/profile',
            ['Authorization: Bearer ' . ($tokens['access_token'] ?? '')]
        );

        if (!isset($profile['userId'])) {
            throw new RuntimeException('ユーザー情報取得エラー: ' . ($profile['message'] ?? '不明なエラー'));
        }

        // メールは「メールアドレス取得権限」の申請が通っている場合のみ id_token に入る
        $email = '';
        $nonce = $_SESSION['oauth_nonce_line'] ?? '';
        unset($_SESSION['oauth_nonce_line']);

        if (!empty($tokens['id_token'])) {
            $claims = self::decodeJwtPayload((string) $tokens['id_token']);

            if ($nonce !== '' && ($claims['nonce'] ?? '') !== $nonce) {
                throw new RuntimeException('id_tokenの検証に失敗しました。');
            }
            $email = (string) ($claims['email'] ?? '');
        }

        return [
            'id'       => (string) $profile['userId'],
            'email'    => $email,
            'name'     => (string) ($profile['displayName'] ?? ''),
            'picture'  => (string) ($profile['pictureUrl'] ?? ''),
            'verified' => $email !== '',
        ];
    }
}

/**
 * config.php の定数が実際に使える値かどうかを判定する。
 * マスク値（XXXX を含む）のままなら未設定として扱う。
 */
function auriga_oauth_is_configured(string ...$constants): bool
{
    foreach ($constants as $name) {
        if (!defined($name)) {
            return false;
        }
        $value = constant($name);
        if (!is_string($value) || $value === '' || str_contains($value, 'XXXX')) {
            return false;
        }
    }

    return true;
}

/**
 * ログイン／新規登録ページに渡す認可 URL の一覧を作る。
 * キーが未設定のプロバイダーは null になり、ボタンが disabled のままになる。
 *
 * @return array<string, string|null>
 */
function auriga_social_login_urls(): array
{
    $urls = [
        'github' => null,
        'google' => null,
        'x'      => null,
        'apple'  => null,
        'line'   => null,
    ];

    if (auriga_oauth_is_configured('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI')) {
        $urls['google'] = (new GoogleOAuth())->getAuthorizationUrl();
    }
    if (auriga_oauth_is_configured('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI')) {
        $urls['github'] = (new GitHubOAuth())->getAuthorizationUrl();
    }
    if (auriga_oauth_is_configured('X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI')) {
        $urls['x'] = (new XOAuth())->getAuthorizationUrl();
    }
    // Apple は .p8 秘密鍵が置かれていないと client_secret を作れない
    if (auriga_oauth_is_configured('APPLE_TEAM_ID', 'APPLE_CLIENT_ID', 'APPLE_KEY_ID', 'APPLE_REDIRECT_URI')
        && defined('APPLE_PRIVATE_KEY_PATH') && is_readable(APPLE_PRIVATE_KEY_PATH)) {
        $urls['apple'] = (new AppleOAuth())->getAuthorizationUrl();
    }
    if (auriga_oauth_is_configured('LINE_CLIENT_ID', 'LINE_CLIENT_SECRET', 'LINE_REDIRECT_URI')) {
        $urls['line'] = (new LineOAuth())->getAuthorizationUrl();
    }

    return $urls;
}
