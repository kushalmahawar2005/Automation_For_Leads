# VPS pe Docker se Deploy karna (WhatsApp Automation)

Ye guide aapke "QR show nahi hota / link nahi hota" aur "message send nahi hota (400)"
problem ko fix karta hai. Root cause: serverless/kam-RAM hosting pe Chromium chal nahi
paata. VPS + Docker me Chromium image ke andar installed hai, session disk pe save hoti
hai, aur process 24/7 zinda rehti hai.

## 0. VPS requirement
- **Ubuntu 22.04**, **minimum 2GB RAM** (Chromium ke liye zaroori — 512MB pe link nahi hoga)
- Providers: Hostinger / DigitalOcean / Contabo (~₹350–500/month me 2GB mil jaata hai)

## 1. VPS pe Docker install karo
```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh
```

## 2. Code laao
```bash
git clone https://github.com/kushalmahawar2005/Automation_For_Leads.git
cd Automation_For_Leads
```

## 3. Config edit karo (optional)
`docker-compose.yml` me `ADMIN_EMAIL` aur `SERP_API_KEY` apne hisaab se set karo.

## 4. Build + start
```bash
docker compose up -d --build
```
Pehli baar build me 3–5 min lagenge (Chromium download hota hai).

## 5. Logs dekho (QR scan ke liye)
```bash
docker compose logs -f
```
App ab `http://YOUR_VPS_IP:3000` pe chal rahi hai. Browser me kholo, login karo,
WhatsApp QR scan karo. **QR ek hi baar scan karna padega** — session `/data/wwebjs_auth`
(persistent volume) me save ho jaati hai, redeploy pe bhi bani rehti hai.

## 6. (Recommended) Domain + HTTPS
Nginx reverse proxy lagao taaki `https://yourdomain.com` se chale:
```bash
apt install -y nginx certbot python3-certbot-nginx
# /etc/nginx/sites-available me proxy_pass http://localhost:3000;
certbot --nginx -d yourdomain.com
```

---

## Update kaise karein (naya code push hone par)
```bash
git pull
docker compose up -d --build
```

## Useful commands
```bash
docker compose ps           # status
docker compose logs -f      # live logs
docker compose restart      # restart
docker compose down         # stop (volume/data safe rehta hai)
```

## Troubleshooting
- **QR nahi aa raha** → `docker compose logs -f` me Chromium error dekho. Usually RAM kam
  hai — `free -m` se check karo, 2GB se kam hai to upgrade karo.
- **Scan ke baad link nahi hota** → ye OOM (memory) crash hai. 2GB RAM + `shm_size: 1gb`
  (already compose me set hai) is fix karta hai.
- **Har baar dobara QR** → matlab volume mount nahi hua. `docker volume ls` me `wa-data`
  hona chahiye; `WWEBJS_AUTH_PATH=/data/wwebjs_auth` set hai ya nahi confirm karo.
