# Virtual Lab
The ‘Virtual Lab’ was developed as a digital learning space for students and lecturers for hybrid teaching. It combines the functions of a web-based collaborative whiteboard with a playful and creative element.
By providing a variety of illustrations of everyday objects in a work or classroom context, for example: tables, chairs, plants, computers, projectors, coffee cups, presentation screens and much more, each course participant can help to shape the virtual spaces or working environments.
Course participants, whether on-site or joining digitally, can thus collaborate to design their workspace and document processes and results. The lecturer can create workstations and provide learning materials in advance. 
The Virtual Laboratory was developed as part of the [KITeGG](gestaltung.ai) research project at the [AI+D Lab](https://aid-lab.hfg-gmuend.de/articles/digital-ai-d-lab/), University of Applied Design Schwäbisch Gmünd.

## Deployment Guide

End-to-end instructions for deploying this excalidraw fork on your own Ubuntu server, behind nginx with HTTPS. Replace `yourserver.de` domain and the example paths/IPs with your own.

---

## 1. Architecture — three independent pieces

| #   | Piece              | What it is                                                                                               | Port | Lives behind            |
| -----| --------------------| ----------------------------------------------------------------------------------------------------------| ------| -------------------------|
| 1   | **Frontend**       | static files from `yarn build` (`excalidraw-app/build/`)                                                 | —    | `yourserver.de`         |
| 2   | **Storage server** | `storage-server/` (Express) — scenes, libraries, image/PDF files                                         | 3003 | `storage.yourserver.de` |
| 3   | **Collab server**  | [excalidraw-room](https://github.com/excalidraw/excalidraw-room) (socket.io) — relays live collaboration | 3002 | `collab.yourserver.de`  |

The frontend is a static site. The two backends run as **systemd services**. nginx
reverse-proxies each backend on its own **subdomain** (cleaner TLS + WebSockets than
URL paths).

---

## 2. Prerequisites

- An Ubuntu server with a public IP and `sudo`.
- A domain you control (DNS access).
- **Node.js** available system-wide *or* under the service user (see §4).
- nginx + certbot

---

## 3. DNS records

In your registrar / DNS panel, create **A records** pointing at your server's IPv4:

| Type | Name (label) | Value |
|---|---|---|
| A | `@` (or `yourserver.de`) | your server IP |
| A | `storage` | your server IP |
| A | `collab` | your server IP |

Add matching **AAAA** records if you have IPv6. 

---

## 4. Server prep — user, Node, directories

Run a dedicated, unprivileged user for the backends (don't run them as root):

```bash
# dedicated service user (home in /opt so systemd's ProtectHome doesn't block it)
sudo useradd -r -s /usr/sbin/nologin -d /opt/excalidraw excalidraw
sudo mkdir -p /opt/excalidraw
sudo chown -R excalidraw:excalidraw /opt/excalidraw

# persistent data dir for the storage server (OUTSIDE any repo)
sudo mkdir -p /var/lib/excalidraw-storage
sudo chown excalidraw:excalidraw /var/lib/excalidraw-storage
```

**Node.js for the service user.** systemd can't use nvm's shell magic, so it needs an
absolute node path. Two options:

- **System-wide (simplest):** `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs` → node at `/usr/bin/node`.
- **nvm under the service user:** install nvm as `excalidraw`, then expose a stable symlink:
  ```bash
  sudo -u excalidraw -H bash -c \
    'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash'
  sudo -u excalidraw -H bash -c \
    'export NVM_DIR=/opt/excalidraw/.nvm; . "$NVM_DIR/nvm.sh"; nvm install 24; nvm alias default 24'
  # stable symlink the unit files point at (re-run after a node upgrade):
  sudo ln -sf /opt/excalidraw/.nvm/versions/node/v24.16.0/bin/node /usr/local/bin/excalidraw-node
  ```

The provided unit files use `/usr/local/bin/excalidraw-node`. If you went system-wide,
either symlink it (`sudo ln -sf /usr/bin/node /usr/local/bin/excalidraw-node`) or edit
`ExecStart` in the units to `/usr/bin/node`.

---

## 5. Deploy the storage server

```bash
sudo -u excalidraw cp -r storage-server /opt/excalidraw/storage-server
cd /opt/excalidraw/storage-server
sudo -u excalidraw npm install        # express + cors
```

It reads two env vars (set in the systemd unit): `PORT=3003`,
`DATA_DIR=/var/lib/excalidraw-storage`.

---

## 6. Deploy the collab server (only if you want collaboration)

```bash
sudo -u excalidraw git clone https://github.com/excalidraw/excalidraw-room \
  /opt/excalidraw/excalidraw-room
cd /opt/excalidraw/excalidraw-room
sudo -u excalidraw yarn install
sudo -u excalidraw yarn build          # produces dist/index.js
```

> If you don't self-host collaboration, you can point `VITE_APP_WS_SERVER_URL`
> (§9) at the public `https://oss-collab.excalidraw.com` instead and skip this.

---

## 7. systemd services

Copy the unit files, reload, enable, start:

```bash
sudo cp deploy/excalidraw-storage.service deploy/excalidraw-collab.service \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now excalidraw-storage excalidraw-collab
sudo systemctl status excalidraw-storage --no-pager -l
sudo systemctl status excalidraw-collab  --no-pager -l
```

Logs: `journalctl -u excalidraw-storage -f` (or `-collab`).

Common first-start errors:
- `status=217/USER` — the `excalidraw` user doesn't exist (redo §4).
- `status=203/EXEC` — node path wrong; check `ExecStart` / the `excalidraw-node` symlink.
- `status=200/CHDIR` — `WorkingDirectory` doesn't exist or isn't readable by the user.

---

## 8. nginx reverse proxy + HTTPS

The provided configs reference TLS certs that don't exist yet, which creates a
chicken-and-egg (`nginx -t` fails → certbot can't run). Break it per subdomain:

```bash
DOMAIN=storage.yourserver.de        # repeat for collab. and the apex

# 1. temporary HTTP-only stub so nginx is valid
sudo tee /etc/nginx/sites-available/$DOMAIN >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:3003; }   # 3002 for collab
}
EOF
sudo ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. get the cert ONLY (don't let certbot rewrite your config)
sudo certbot certonly --nginx -d $DOMAIN

# 3. drop in the real config (now the cert paths exist)
sudo cp deploy/nginx-storage.yourserver.de.conf /etc/nginx/sites-available/$DOMAIN
sudo nginx -t && sudo systemctl reload nginx
```

Provided configs:
- `nginx-storage.yourserver.de.conf` — includes **`client_max_body_size 30m`** (required for PDF/image uploads; nginx defaults to 1 MB).
- `nginx-collab.yourserver.de.conf` — includes the **WebSocket upgrade headers** + long timeouts.
- `nginx-yourserver.de.conf` — serves the static frontend with sane caching.

> Use `certonly` (not plain `--nginx`) so certbot doesn't overwrite your configs and
> strip the WebSocket headers / body-size limit.

Symlink helpers: `ln -s <target> <link>` enables a site; `ln -sf` force-overwrites
(used for the node symlink). Disable a site by removing its `sites-enabled` symlink.

---

## 9. Build & deploy the frontend

Env vars are **baked in at build time** (Vite), so set them *before* building. In
`.env.production`:

```
VITE_APP_STORAGE_SERVER_URL=https://storage.yourserver.de
VITE_APP_WS_SERVER_URL=https://collab.yourserver.de
```

Then build and publish the static output:

```bash
yarn build
sudo mkdir -p /var/www/excalidraw
sudo rsync -a --delete excalidraw-app/build/ /var/www/excalidraw/
```

(The `nginx-yourserver.de.conf` vhost serves `/var/www/excalidraw`.)

**Rebuild + re-rsync whenever you change a `VITE_APP_*` URL** — they're compile-time.

---

## 10. Migrating existing room data (it load the virtual lab library)

Room data is encrypted-but-portable, keyed by roomId. To move a room from another
machine, copy the storage `DATA_DIR` contents, then **fix ownership** (critical):

```bash
# from the old machine
rsync -av storage-server/data/ root@SERVER:/var/lib/excalidraw-storage/
# on the server — MUST chown, or the service user can't write and the server crashes
sudo chown -R excalidraw:excalidraw /var/lib/excalidraw-storage
sudo systemctl restart excalidraw-storage
```

---


## 11. Verify the whole stack

```bash
# storage server reachable (404 with JSON body = working, just no data for that id)
curl -i https://storage.yourserver.de/scenes/none      # -> 404 {"error":"not found"}

# round-trip write
curl -i -X PUT https://storage.yourserver.de/files/test/abc \
  -H "Content-Type: application/octet-stream" --data-binary "hello"
curl -s https://storage.yourserver.de/files/test/abc   # -> hello

# collab server upgrade (should not 502)
curl -i https://collab.yourserver.de/

# frontend
curl -I https://yourserver.de/                          # -> 200
```

Then open `https://yourserver.de`, create a room, draw, drop a PDF — and confirm
saves succeed (watch `journalctl -u excalidraw-storage -f`).