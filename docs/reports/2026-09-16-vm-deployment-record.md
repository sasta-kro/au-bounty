# AU Bounty VM Deployment Record

Date: 2026-09-16. Written as a walkthrough so the whole deployment can be understood and repeated by hand. Live address after deployment:

```
https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty/
```

Shortened below as `https://FQDN/aubounty/`.

## 0. The plan

The SPA and the API share the course VM domain under the path `/aubounty/`. The app was already designed around that prefix: the API mounts at `/aubounty/api`, socket.io at `/aubounty/socket.io`, and the session cookie is scoped to `Path=/aubounty`.

Two nginx layers do the routing:

```
browser
  -> VM nginx on 443, TLS, one location /aubounty/
  -> frontend container (its own nginx, published on 127.0.0.1:8090)
  -> api container for /aubounty/api and /aubounty/socket.io
```

Images are built on the Mac, pushed to `ghcr.io/sasta-kro`, pulled on the VM. The VM never builds from source.

Port choices on the VM:

- 8080 already belongs to Apache and WordPress, so the frontend container publishes to `127.0.0.1:8090` instead.
- peer-mock publishes to `127.0.0.1:7090` for SSH tunnel demos only.
- postgres, minio, and api publish nothing. They stay on the internal compose network.

The loopback binds mean nothing new is exposed publicly. Port 443 was already open in the Azure NSG (the cloud firewall in front of the VM), so no portal change was needed.

## 1. Frontend subpath support

Problem: the SPA was built for the domain root. Vite had no base and the router had no basename, so built asset links pointed to `/assets/...` which belongs to the old w5 frontend on the VM.

Changes in the frontend repo, commit `f401057` "add subpath mount for shared-domain hosting":

1. `vite.config.js`: `base: '/aubounty/'`. Built asset URLs in index.html now start with `/aubounty/assets/`.
2. `src/main.jsx`: the BrowserRouter basename is derived from `import.meta.env.BASE_URL` so the router and vite always agree on one constant.
3. `src/screens/Profile.jsx`: the public profile share link includes the base path.
4. `nginx.conf`: the SPA fallback becomes `try_files $uri /aubounty/index.html`, and a bare `/` redirects to `/aubounty/`. The existing `/aubounty/api/` and `/aubounty/socket.io/` proxy locations were left untouched.
5. `Dockerfile`: dist is copied to `/usr/share/nginx/html/aubounty` so file paths on disk match the URLs.

Verification before committing:

```bash
cd frontend
npm run lint
npm run build
grep -o '/aubounty/assets/[^"]*' dist/index.html   # must show the prefix
```

## 2. GHCR login (one time, on the Mac)

The gh CLI token did not have the packages scope, so a scope refresh ran first. It prints a one time code that must be entered at https://github.com/login/device:

```bash
gh auth refresh -s write:packages -h github.com
gh auth token | docker login ghcr.io -u sasta-kro --password-stdin
```

## 3. Build and push amd64 images (on the Mac)

The Mac is arm64, the VM is amd64, so builds must target the amd64 platform explicitly. Docker Desktop emulates amd64 during the build steps, which is slower but works.

```bash
cd backend
docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-backend:latest --push .

cd ../frontend
docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-frontend:latest --push .
```

After the push, both packages were switched to public in the GitHub UI (profile, Packages tab, package, Package settings, Danger Zone, Change visibility). The REST API route for the visibility change returned 404, so the UI was used. Public packages allow the VM to pull anonymously, no docker login needed on the VM.

## 4. Docker install on the VM

Official Docker apt repository method for Ubuntu 24.04:

```bash
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker azureuser   # takes effect on next login
```

Result: Docker 29.8.1 and Compose v5.5.1.

## 5. Deploy directory and files on the VM

Directory `~/apps/au-bounty/` holds two files:

- `docker-compose.azure.yml`: same six services as the root compose (postgres, minio, minio-init, api, peer-mock, frontend) but with `image: ghcr.io/...` instead of `build:`, loopback only port binds, `restart: unless-stopped`, and the VM environment values (CORS origin, callback base, APP_ORIGIN, COOKIE_SECURE true, DEV_AUTH 0). Tracked in the umbrella repo.
- `.env.azure`: the secret half. chmod 600, never committed, never printed. Contents shape:

```
ENTRA_TENANT_ID=...        # from the Entra app registration
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...    # the ms7... Value from Certificates and secrets
JWT_SECRET=...             # openssl rand -base64 48
PEER_API_KEY=...           # openssl rand -hex 24
```

The random values were generated on the VM itself so they never left the machine. JWT_SECRET and PEER_API_KEY are required variables in the compose file (`:?` syntax), so compose refuses to run without the env file.

## 6. VM nginx block

The active gateway config is `/etc/nginx/sites-available/default` (symlinked in sites-enabled). The 443 server block already proxied `/api`, `/go/api/`, and `/content/` for the old course services.

A backup was taken first:

```bash
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup-20260916
```

Two additions inside that file:

1. A websocket map at the http level (top of the file), because socket.io rides the same location as SPA and REST traffic:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

2. One location inside the 443 server block:

```nginx
location /aubounty/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    client_max_body_size 64m;
    proxy_connect_timeout 10s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;
}
```

One block is enough because the frontend container nginx already splits `/aubounty/api`, `/aubounty/socket.io`, assets, and the SPA fallback internally. Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Entra configuration (portal)

In the AuBounty app registration:

- Redirect URI added on the Web platform: `https://FQDN/aubounty/api/auth/callback`. Non localhost redirect URIs must be https, matched exactly and case sensitive, and the port counts. The localhost entry stays for local dev.
- The client secret Value (ms7..., expires 2027-03-08) went into `.env.azure` on the VM as ENTRA_CLIENT_SECRET.

## 8. Pull and start on the VM

First attempt failed on the MinIO images: `minio/minio` and `minio/mc` returned "repository does not exist" on Docker Hub. Cause: MinIO stopped publishing to Docker Hub in 2025. The Mac local compose only kept working because the images were already in the local cache. Fix: both compose files now pull from quay.io (`quay.io/minio/minio`, `quay.io/minio/mc`), umbrella commit `955f031`.

Start command, run from `~/apps/au-bounty`:

```bash
docker compose -f docker-compose.azure.yml --env-file .env.azure pull
docker compose -f docker-compose.azure.yml --env-file .env.azure up -d --wait
```

The `--env-file .env.azure` flag is required on every compose command in this directory. The api container runs `prisma migrate deploy` on start, then seeds when the database is empty (SEED_ON_BOOT=1). First boot applied 3 migrations and seeded 7 users, 2 orgs, 16 tags, 9 tasks, 9 assignments, 4 reviews.

## 9. Verification (from outside the VM)

```bash
curl https://FQDN/aubounty/                     # 200, the SPA shell
curl https://FQDN/aubounty/assets/index-*.js    # 200, built asset under the prefix
curl https://FQDN/aubounty/api/health           # {"ok":true,"version":"0.5.0"}
curl https://FQDN/aubounty/api/meta             # devAuth false, entra configured true
curl "https://FQDN/aubounty/socket.io/?EIO=4&transport=polling"
                                                # handshake with websocket upgrade offer
curl -s -o /dev/null -w "%{redirect_url}\n" "https://FQDN/aubounty/api/auth/login?returnTo=%2Faubounty%2Fboard"
                                                # 302 to login.microsoftonline.com with the https redirect_uri
curl https://FQDN/                              # old frontend still 200
curl https://FQDN/content/                      # WordPress still 200
```

All passed. The login 302 carried the exact registered redirect URI, the tenant ID, and the client ID, which validates the whole Entra wiring without opening a browser.

## 10. Final state

```
VM dir        ~/apps/au-bounty (docker-compose.azure.yml + .env.azure)
Images        ghcr.io/sasta-kro/au-bounty-backend:latest, au-bounty-frontend:latest
Frontend      container port 80 published on 127.0.0.1:8090
peer-mock     container port 7000 published on 127.0.0.1:7090
Restart       unless-stopped on every service, survives VM reboot
Nginx backup  /etc/nginx/sites-available/default.backup-20260916
TLS cert      Let's Encrypt, valid to 2026-11-24, auto renewing
```

Commits: frontend `f401057` (subpath mount), umbrella `0b89d00` (azure compose + env template), `7f9ad77` (frontend pin bump), `955f031` (quay.io minio fix). The sanitized `.env.azure` template in the umbrella keeps the Entra IDs but never secret values.

## 11. Redeploy flow

```bash
# Mac: commit and push submodule changes first
cd backend && docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-backend:latest --push .
cd ../frontend && docker buildx build --platform linux/amd64 -t ghcr.io/sasta-kro/au-bounty-frontend:latest --push .

# VM:
cd ~/apps/au-bounty
docker compose -f docker-compose.azure.yml --env-file .env.azure pull
docker compose -f docker-compose.azure.yml --env-file .env.azure up -d
```

## 12. Gotchas learned

- MinIO images are gone from Docker Hub. Use quay.io. A cache on the dev machine can hide this problem.
- A raw curl at a ghcr.io manifest returns 401 even for public images. Testing anonymous pull properly needs the token dance (GET https://ghcr.io/token?scope=repository:OWNER/IMAGE:pull, then send that token).
- For localhost redirect URIs Microsoft ignores the port when matching. Everywhere else the port must match exactly.
- The old PM2 Node API and the Go service on the VM are not running after past reboots. That is unrelated to this deployment. AU Bounty does not depend on them.
