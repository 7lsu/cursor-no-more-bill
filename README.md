# Cursor No More Bill

A Cloudflare Worker that monitors Cursor's usage-based billing status and automatically disables it to prevent unexpected charges.

## Features

- Hourly automated checks via Cron Triggers
- Support for multiple accounts
- WeChat Work (企业微信) notifications
- Automatic disabling of usage-based billing when detected
- Health check and manual trigger endpoints


## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create KV Namespace

```bash
npx wrangler kv:namespace create CURSOR_KV
```

Copy the returned `id` and update it in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CURSOR_KV"
id = "your-kv-namespace-id"  # Replace with your ID
```

### 4. Set WeChat Webhook Key

```bash
npx wrangler secret put WECHAT_WEBHOOK_KEY
```

Enter your WeChat Work webhook key when prompted.

### 5. Deploy

```bash
npm run deploy
```

### 6. Add Account Data to KV

Go to Cloudflare Dashboard → Workers & Pages → KV → Your Namespace

Add a new entry:
- **Key**: `cursor_accounts`
- **Value**:
```json
[
  {
    "email": "user@example.com",
    "cookie": "WorkosCursorSessionToken=..."
  }
]
```

## Getting Your Cookie

To retrieve the cookie for a logged-in session on cursor.com within Chrome DevTools, it must include the `WorkosCursorSessionToken`.


## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Service information |
| `GET /check` | Manually trigger check |
| `GET /health` | Health check |

## License

MIT
