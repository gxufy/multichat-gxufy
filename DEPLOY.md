# multichat-gxufy — VPS deploy (Oracle free tier / any Ubuntu VPS)

One Node process serves everything: landing page, overlay, YouTube proxy, TikTok SSE.
In front of it, Caddy handles your domain + automatic HTTPS.

```
visitors → https://yourdomain.com → Caddy (443) → Node app (localhost:3000)
```

## 1. Point your domain at the VPS

At your domain registrar, create an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS public IP |
| A | `www` | your VPS public IP (optional) |

DNS can take a few minutes to propagate.

## 2. Open ports on Oracle

Oracle blocks inbound traffic in TWO places — do both:

**a) VCN Security List** (Oracle Cloud console → Networking → your VCN → Security Lists → Default):
add Ingress rules for TCP **80** and **443**, source `0.0.0.0/0`.

**b) OS firewall** (on the VPS):
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo apt install -y iptables-persistent
```

## 3. Install Node 20 + the app

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/gxufy/multichat-gxufy.git
cd multichat-gxufy
npm install
npm run build
```

## 4. Run it with pm2 (survives crashes + reboots)

```bash
sudo npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # then run the command it prints
```

Optional — raise TikTok signing rate limits with a free key from https://www.eulerstream.com/:
```bash
pm2 restart multichat --update-env
# after adding TIKTOK_SIGN_API_KEY to ecosystem.config.js env block
```

## 5. Caddy (domain + auto-HTTPS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# put your domain into the Caddyfile, then:
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches and renews the TLS certificate automatically. That's it —
`https://yourdomain.com` is live; people enter channel names and go.

## Updating later

**Automatic (recommended):** every push to `main` deploys itself via
GitHub Actions (`.github/workflows/deploy.yml`). One-time setup — add
three repo secrets (GitHub → repo → Settings → Secrets and variables →
Actions):

| Secret | Value |
|---|---|
| `VPS_HOST` | your VPS public IP (or domain) |
| `VPS_USER` | the SSH user, e.g. `ubuntu` |
| `VPS_SSH_KEY` | a private key whose public half is in the VPS `~/.ssh/authorized_keys` |

Generate a dedicated deploy key (don't reuse your personal one):
```bash
# on your PC
ssh-keygen -t ed25519 -f deploykey -N ""
# put deploykey.pub on the VPS:
ssh ubuntu@YOUR_IP "cat >> ~/.ssh/authorized_keys" < deploykey.pub
# paste the contents of `deploykey` (private) into the VPS_SSH_KEY secret
```

After that: edit code → `git push` → live in ~2 minutes. The Actions tab
shows each deploy; the workflow can also be run manually from there.

**Manual (fallback):**
```bash
cd multichat-gxufy
git pull
npm ci
npm run build
pm2 restart multichat
```

## Notes for public traffic

- Kick, Twitch, and all emote/cosmetic APIs connect from each visitor's
  browser — zero load on the VPS regardless of user count.
- YouTube chat is polled through this server (light JSON proxying).
- TikTok holds one server-side connection **per overlay viewer** using a
  TikTok channel. Fine at launch; if TikTok usage grows, connections
  should be deduplicated per channel (planned improvement).
