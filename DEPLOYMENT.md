# Deployment Guide

## Server Requirements

- Ubuntu 22.04+ or Debian 12+
- Docker & Docker Compose
- Public IP with UDP port 51820 open (WireGuard)
- Ports 8001 (API) and 8090 (Admin UI) open

## Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Clone repository
git clone https://github.com/Ralle1976/arma3-session-bridge.git /opt/arma3-session-bridge
cd /opt/arma3-session-bridge
```

## Configuration

1. Copy environment template:
```bash
cp .env.example .env
```

2. Edit `.env` with your values:
```bash
nano .env
```

Required variables:
```env
# WireGuard
WG_HOST=<YOUR_SERVER_IP>
WG_PORT=51820

# API
API_SECRET_KEY=<GENERATE_RANDOM_32CHAR_STRING>
ADMIN_PASSWORD=<YOUR_ADMIN_PASSWORD>

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<YOUR_BOT_TOKEN>
TELEGRAM_CHAT_ID=<YOUR_CHAT_ID>
```

## Deploy

```bash
# Build and start all services
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f api
```

## Update

```bash
cd /opt/arma3-session-bridge
git pull origin master
docker compose up -d --build
```

## Health Checks

- API: `http://<SERVER_IP>:8001/health`
- Admin UI: `http://<SERVER_IP>:8090`

## Firewall (UFW)

```bash
ufw allow 22/tcp      # SSH
ufw allow 51820/udp   # WireGuard
ufw allow 8001/tcp    # API
ufw allow 8090/tcp    # Admin UI
ufw enable
```

## Troubleshooting

### WireGuard not connecting
- Check UDP port 51820 is open in firewall
- Verify WG_HOST matches your server's public IP
- Check WireGuard logs: `docker compose logs wireguard`

### API not responding
- Check container status: `docker compose ps`
- View API logs: `docker compose logs api`
- Verify .env file exists and has correct values

### Database errors
- Database is stored in Docker volume
- Reset: `docker compose down -v && docker compose up -d`
