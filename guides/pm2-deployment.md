# PM2 Deployment

[← Back to main README](../README.md)

PM2 keeps NAISYS running through system restarts, NAISYS upgrades, and unexpected crashes. A NAISYS server uses around 180 MB of RAM, so a $6/month Digital Ocean Droplet is enough to host one.

## Dedicated user

Create a dedicated user on your server and any client/host machines:

```bash
npm install -g pm2
sudo useradd -m -s /bin/bash naisys
sudo su - naisys
```

## Server

Install NAISYS and the supporting packages, then start under PM2:

```bash
npm install naisys @naisys/hub @naisys/supervisor @naisys/erp
pm2 start npx --name naisys-server -- naisys --integrated-hub --supervisor --erp
```

## Hosts

On each machine you want to join the server:

```bash
npm install naisys
pm2 start npx --name naisys-client -- naisys --hub=https://<server>/hub
```

## Persist across reboots

Run once on each machine to register PM2's boot service and snapshot the current process list:

```bash
pm2 startup
pm2 save
```

## Exposing a home server

If your server isn't already public, [ngrok](https://ngrok.com/) is the simplest way to give remote hosts a reachable URL:

```bash
ngrok http <port of your naisys server>
```

Use the ngrok URL as `--hub=https://<server>/hub` on the hosts.
