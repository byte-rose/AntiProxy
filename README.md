# AntiProxy

A high-performance, multi-protocol AI proxy server with intelligent account rotation, quota management, and a beautiful web console. Built with Rust for maximum performance and reliability.

## Features

- **Multi-Protocol Support**: Compatible with OpenAI, Anthropic (Claude), and Gemini API formats
- **Intelligent Account Rotation**: Automatically switches between accounts based on quota, rate limits, and session stickiness
- **Model Router**: Map client-requested models to your preferred upstream targets
- **Multi-API-Key Management**: Create multiple API keys with isolated usage tracking
- **WebAuthn Authentication**: Secure passkey-based authentication for the web console
- **Real-time Monitoring**: Track requests, tokens, and quota usage across all accounts
- **Docker Ready**: Easy deployment with pre-built Docker images

## Quick Start

### Option 1: Docker (Recommended)

```bash
docker run -d --name antiproxy \
  -p 8045:8045 \
  -e ANTI_PROXY_BIND=0.0.0.0 \
  -e ANTI_PROXY_ALLOW_LAN=1 \
  -v antiproxy-data:/root/.AntiProxy \
  linwanxiaoyehua/antiproxy:latest
```

Open the web console: `http://localhost:8045`

### Option 2: Build from Source

1. Install Rust (stable toolchain):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. Clone and build:
   ```bash
   git clone https://github.com/user/Antigaavity-Web.git
   cd Antigaavity-Web
   cargo build --release
   ```

3. Run the server:
   ```bash
   cargo run --release
   ```

4. Open the web console: `http://localhost:8045`

## Web Console Pages

### Overview

The main dashboard showing:
- **Summary Stats**: Total accounts, average Gemini/Claude quota remaining
- **Current Account**: The account currently being used for API requests (updates in real-time as requests are made)
- **Other Accounts**: Quick view of all accounts with their quota status
- **Add Account**: Two methods to add new Google accounts:
  - **OAuth Login** (Recommended): Click "Start OAuth Login" and authorize with your Google account
  - **Refresh Token**: Manually paste a refresh token if you have one

### API Proxy

Configure how the proxy handles API requests:

- **Model Router**: Map model families to upstream targets
  - Claude 4.5 Series (Opus, Sonnet, Haiku)
  - Claude 3.5 Series (Sonnet, Haiku)
  - GPT-4 Series (o1, o3, gpt-4)
  - GPT-4o / 3.5 Series (4o, turbo, mini)
  - GPT-5 Series
  - Custom mappings for exact model name overrides

- **Multi-Protocol Support**:
  - OpenAI: `/v1/chat/completions`, `/v1/completions`, `/v1/responses`
  - Anthropic: `/v1/messages`
  - Gemini: `/v1beta/models/...`

- **Code Examples**: Ready-to-use integration examples for each protocol

### Accounts

Manage all your Google accounts:
- View account email, status (Active/Disabled), subscription tier
- See Gemini and Claude quota percentages
- Actions: Set as current, refresh quota, disable/enable, delete
- Drag to reorder account priority

### API Keys

Create and manage multiple API keys:
- **Total Usage**: Aggregated stats across all keys (requests, tokens)
- **Per-Key Stats**: Individual usage tracking for each API key
- Actions: Copy key, regenerate, enable/disable, reset usage, delete

### Settings

- **Appearance**: Light/Dark/System theme
- **Danger Zone**: Reset authentication (removes all passkeys)

## Integration Guide

### Using with Claude Code

Configure Claude Code to use AntiProxy as the API endpoint:

```bash
# Set the API endpoint to your AntiProxy server
export ANTHROPIC_BASE_URL="http://localhost:8045"

# Set your AntiProxy API key (create one in the API Keys page)
export ANTHROPIC_API_KEY="sk-your-antiproxy-key"

# Run Claude Code as normal
claude
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export ANTHROPIC_BASE_URL="http://localhost:8045"
export ANTHROPIC_API_KEY="sk-your-antiproxy-key"
```

### Using with Codex (OpenAI CLI)

Configure Codex to use AntiProxy:

```bash
# Set the API endpoint
export OPENAI_BASE_URL="http://localhost:8045/v1"

# Set your AntiProxy API key
export OPENAI_API_KEY="sk-your-antiproxy-key"

# Run Codex as normal
codex
```

### Using with Gemini CLI

Configure Gemini CLI to use AntiProxy:

```bash
# Set the API endpoint
export GEMINI_API_BASE="http://localhost:8045"

# Set your AntiProxy API key (if auth is enabled)
export GEMINI_API_KEY="sk-your-antiproxy-key"

# Run Gemini CLI
gemini
```

### Using with OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8045/v1",
    api_key="sk-your-antiproxy-key"
)

response = client.chat.completions.create(
    model="gpt-4o",  # Will be routed based on your Model Router config
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### Using with Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:8045",
    api_key="sk-your-antiproxy-key"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(message.content[0].text)
```

### Using with cURL

```bash
# OpenAI-compatible endpoint
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-antiproxy-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Anthropic-compatible endpoint
curl http://localhost:8045/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-your-antiproxy-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Deployment Guide

### Local Development

```bash
# Run in development mode
cargo run

# Run with hot-reload (requires cargo-watch)
cargo install cargo-watch
cargo watch -x run
```

### Production Deployment

#### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  antiproxy:
    image: linwanxiaoyehua/antiproxy:latest
    container_name: antiproxy
    restart: unless-stopped
    ports:
      - "8045:8045"
    environment:
      - ANTI_PROXY_BIND=0.0.0.0
      - ANTI_PROXY_ALLOW_LAN=1
    volumes:
      - antiproxy-data:/root/.AntiProxy

volumes:
  antiproxy-data:
```

Run:
```bash
docker-compose up -d
```

#### Systemd Service

Create `/etc/systemd/system/antiproxy.service`:

```ini
[Unit]
Description=AntiProxy AI Gateway
After=network.target

[Service]
Type=simple
User=antiproxy
WorkingDirectory=/opt/antiproxy
ExecStart=/opt/antiproxy/antiproxy
Restart=always
RestartSec=5
Environment=ANTI_PROXY_BIND=0.0.0.0
Environment=ANTI_PROXY_ALLOW_LAN=1

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable antiproxy
sudo systemctl start antiproxy
```

#### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8045;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For streaming responses
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTI_PROXY_BIND` | Bind address | `127.0.0.1` |
| `ANTI_PROXY_ALLOW_LAN` | Allow LAN access (`1`/`true`/`yes`/`on`) | `false` |
| `ANTI_PROXY_ENABLED` | Force enable proxy | `false` |
| `ANTI_PROXY_PORT` | Server port | `8045` |

### Config File

`web_config.json` is created automatically on first run. You can adjust:

```json
{
  "port": 8045,
  "allow_lan_access": false,
  "auth_mode": "none",
  "anthropic_mapping": { ... },
  "openai_mapping": { ... },
  "custom_mapping": { ... }
}
```

### Data Directory

All data is stored in `~/.AntiProxy/`:

```
~/.AntiProxy/
├── accounts/           # Google account credentials
│   ├── {id}.json
│   └── ...
├── account_index.json  # Account list and current account
├── web_config.json     # Proxy configuration
├── api_keys.db         # API keys database
├── proxy_logs.db       # Request logs database
└── webauthn.db         # WebAuthn credentials
```

## Authentication

AntiProxy supports multiple authentication methods:

1. **No Auth**: Open access (suitable for local development)
2. **API Key**: Require `Authorization: Bearer <key>` or `x-api-key` header
3. **WebAuthn**: Passkey-based authentication for web console

Create API keys in the **API Keys** page to enable authenticated access.

## Troubleshooting

### Token Statistics Show 0

Ensure the Monitor is enabled. In the web console, check Settings or restart the server - Monitor is enabled by default.

### Account Quota Not Updating

Click "Refresh All Quotas" in the Overview page to force-refresh quota data from Google.

### Rate Limit Errors

AntiProxy automatically rotates accounts when rate limits are hit. If all accounts are limited:
- Wait for the rate limit to reset (typically a few minutes)
- Add more accounts to increase capacity

### Connection Refused

Check that:
- The server is running (`cargo run` or `docker ps`)
- The port is correct (default: 8045)
- Firewall allows the connection
- For LAN access, set `ANTI_PROXY_ALLOW_LAN=1`

## Credits

Inspired by [`Antigravity-Manager`](https://github.com/lbjlaq/Antigravity-Manager) by lbjlaq, with some code adapted from the original project.
This project is licensed under the same terms (CC BY-NC-SA 4.0). See `LICENSE` for details.
