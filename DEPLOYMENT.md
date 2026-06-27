# LMS Arbitrage Bot Production Deployment

This guide deploys:
- Backend API (Flask bot) to a DigitalOcean Ubuntu 22.04 VPS
- React dashboard to Vercel

## 1) Deployment Package Included in This Project

Backend (VPS):
- `requirements.txt` (all Python runtime dependencies)
- `bot_api.py` (env-configurable host/port and CORS origins)
- `.env.vps.example` (VPS environment template)
- `deploy/start_bot.sh` (startup script)
- `deploy/setup_system_user.sh` (creates non-root service user and permissions)
- `deploy/bot-api.service` (systemd service)
- `deploy/deploy_update.sh` (one-command update + restart + health check)
- `deploy/start_gunicorn.sh` (Gunicorn launcher)
- `deploy/bot-api-gunicorn.socket` (socket activation)
- `deploy/bot-api-gunicorn.service` (Gunicorn systemd service)
- `deploy/nginx-bot-api.conf` (optional Nginx reverse proxy template)

Frontend (Vercel):
- `src/mobile-dashboard.tsx` (uses `VITE_API_URL` and public view mode)
- `vercel.json` (SPA routing/headers)
- `.env.example` (frontend env keys)

## 2) DigitalOcean Ubuntu 22.04 VPS Setup

### Step 1: Create VPS

- Create a new Ubuntu 22.04 droplet (Basic plan is fine to start)
- Add your SSH key during creation
- Note public IP (example: `165.22.x.x`)

### Step 2: Connect and install system packages

```bash
ssh root@YOUR_DROPLET_IP
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip git ufw
```

### Step 3: Copy project to VPS

Option A (git clone):
```bash
cd /opt
git clone <your-repo-url> lms-arb
cd /opt/lms-arb
```

Option B (upload from local machine using scp):
```bash
scp -r /path/to/Downloads root@YOUR_DROPLET_IP:/opt/lms-arb
ssh root@YOUR_DROPLET_IP
cd /opt/lms-arb
```

### Step 3.1: Create non-root service user (recommended)

```bash
chmod +x /opt/lms-arb/deploy/setup_system_user.sh
/opt/lms-arb/deploy/setup_system_user.sh
```

Default account created:
- user: `lmsarb`
- group: `lmsarb`

### Step 4: Create Python virtual environment and install dependencies

```bash
cd /opt/lms-arb
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 5: Configure backend environment variables

```bash
cp .env.vps.example .env
nano .env
```

Set at minimum:
- `BSC_RPC_URL` or `QUICKNODE_URL`
- `BOT_HOST=0.0.0.0`
- `BOT_PORT=5003`
- `ALLOWED_ORIGINS=https://your-dashboard.vercel.app`

### Step 6: Prepare startup script and systemd service

```bash
chmod +x /opt/lms-arb/deploy/start_bot.sh
chmod +x /opt/lms-arb/deploy/deploy_update.sh
cp /opt/lms-arb/deploy/bot-api.service /etc/systemd/system/bot-api.service
systemctl daemon-reload
systemctl enable bot-api
systemctl start bot-api
```

The service now runs as non-root user `lmsarb`.

### Step 7: Verify backend service

```bash
systemctl status bot-api --no-pager
journalctl -u bot-api -f
curl http://127.0.0.1:5003/api/health
```

Expected: JSON with `alive: true`.

### Step 8: Open firewall for API

```bash
ufw allow OpenSSH
ufw allow 5003/tcp
ufw --force enable
ufw status
```

Backend should now be reachable at:
- `http://YOUR_DROPLET_IP:5003/api/status`

## 3) Vercel Dashboard Deployment

### Step 1: Push frontend project to GitHub

Make sure these files are committed:
- `vercel.json`
- `src/mobile-dashboard.tsx`
- `package.json`

### Step 2: Create Vercel project

- Go to Vercel and import your repository
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

### Step 3: Set Vercel environment variables

In Vercel project settings, add:
- `VITE_API_URL=http://YOUR_DROPLET_IP:5003`
- `VITE_PUBLIC_VIEW=true` (optional default public mode)

Redeploy after adding env vars.

### Step 4: Verify dashboard connection

Open deployed URL and check:
- prices and status are loading
- API calls target your VPS URL
- if `VITE_PUBLIC_VIEW=true`, private controls are hidden

Public mode can also be forced by query:
- `https://your-dashboard.vercel.app/?public=1`

## 4) Production Build (Local Verification)

Run locally before release:

```bash
npm install
npm run build
```

Expected output directory:
- `dist/`

## 5) Recommended Hardening (Next)

- Put API behind Nginx reverse proxy and HTTPS (Let’s Encrypt)
- Restrict `ALLOWED_ORIGINS` to exact Vercel domain(s)
- Add a non-root Linux user and run service as that user
- Set up DigitalOcean backups/snapshots
- Add monitoring (UptimeRobot or Healthchecks)

## 6) Zero-Downtime Option (Gunicorn + Socket Activation)

Use this if you want safer deploy restarts and better production behavior.

### Step 1: Install Nginx (optional but recommended)

```bash
apt install -y nginx
```

### Step 2: Install Gunicorn in the same venv

```bash
cd /opt/lms-arb
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 3: Install Gunicorn units

```bash
chmod +x /opt/lms-arb/deploy/start_gunicorn.sh
cp /opt/lms-arb/deploy/bot-api-gunicorn.socket /etc/systemd/system/
cp /opt/lms-arb/deploy/bot-api-gunicorn.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable bot-api-gunicorn.socket
systemctl start bot-api-gunicorn.socket
```

The Gunicorn service runs as non-root user `lmsarb` and group `www-data`.

### Step 4: Optional Nginx reverse proxy to unix socket

```bash
cp /opt/lms-arb/deploy/nginx-bot-api.conf /etc/nginx/sites-available/bot-api
ln -sf /etc/nginx/sites-available/bot-api /etc/nginx/sites-enabled/bot-api
nginx -t
systemctl restart nginx
```

If domain DNS is set, add HTTPS:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com
```

### Step 5: Validate

```bash
systemctl status bot-api-gunicorn.socket --no-pager
systemctl status bot-api-gunicorn.service --no-pager
curl http://127.0.0.1/api/health
```

### Step 6: Use one-command rollout with Gunicorn

```bash
SERVICE_NAME=bot-api-gunicorn HEALTH_URL=http://127.0.0.1/api/health /opt/lms-arb/deploy/deploy_update.sh
```

### Rollback to original Flask service

```bash
systemctl stop bot-api-gunicorn.service bot-api-gunicorn.socket
systemctl disable bot-api-gunicorn.socket
systemctl enable bot-api
systemctl start bot-api
```

### Rollback to root-run services (not recommended)

If you need emergency rollback, edit unit files in `/etc/systemd/system/`:
- set `User=root` (and remove/adjust `Group=`)
- then run:

```bash
systemctl daemon-reload
systemctl restart bot-api
```

## 7) Operations Commands

Service operations:

```bash
systemctl restart bot-api
systemctl stop bot-api
systemctl start bot-api
systemctl status bot-api --no-pager
journalctl -u bot-api -n 200 --no-pager
```

Code update rollout:

```bash
/opt/lms-arb/deploy/deploy_update.sh
```

Optional custom args via environment variables:

```bash
APP_DIR=/opt/lms-arb SERVICE_NAME=bot-api /opt/lms-arb/deploy/deploy_update.sh
```
