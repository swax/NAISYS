# NAISYS Desktop Setup Guide

Setup a NAISYS agent with an XFCE desktop accessible via VNC on a fresh Ubuntu install.

## 1. Install packages

```bash
sudo apt-get update
sudo apt-get install -y xfce4 tigervnc-standalone-server dbus-x11 scrot
```

- `xfce4` — lightweight desktop environment
- `tigervnc-standalone-server` — VNC server with built-in virtual display (replaces Xvfb + x11vnc)
- `dbus-x11` — provides `dbus-launch`, required by XFCE in headless sessions
- `scrot` — screenshot tool used by NAISYS for desktop interaction

## 2. Install Google Chrome

The Snap version of Firefox does not work in headless X11 sessions due to its Wayland proxy. Install Chrome as a .deb instead.

```bash
wget -O /tmp/google-chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
sudo dpkg -i /tmp/google-chrome.deb
sudo apt-get install -f -y
```

## 3. Create the naisys user

```bash
sudo useradd -m -s /bin/bash naisys
echo "naisys:naisys" | sudo chpasswd
```

## 4. Install NAISYS and configure

Switch to the naisys user, install NAISYS, and configure the `.env` file. The `DISPLAY` and `XAUTHORITY` variables are required for desktop interaction — pm2 does not source `.bashrc` or `.profile`, so they must be set here.

```bash
sudo su - naisys
mkdir client && cd client
npm install naisys
```

```bash
tee /home/naisys/client/.env << EOF
NAISYS_FOLDER=~
HUB_ACCESS_KEY=<your-hub-access-token>
DISPLAY=:2
XDG_SESSION_TYPE=x11
XAUTHORITY=/home/naisys/.Xauthority
EOF
```

## 5. Configure VNC

Create the VNC config directory and files:

```bash
sudo -u naisys mkdir -p /home/naisys/.vnc
```

Create `/home/naisys/.vnc/config` (no password, localhost only):

```bash
echo "SecurityTypes=None" | sudo -u naisys tee /home/naisys/.vnc/config
```

Create `/home/naisys/.vnc/xstartup`:

```bash
sudo -u naisys tee /home/naisys/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11
exec startxfce4
EOF
sudo chmod +x /home/naisys/.vnc/xstartup
```

### Why a dedicated user?

Running a virtual X11 desktop from within an existing Wayland session causes constant
conflicts. Environment variables like `WAYLAND_DISPLAY`, `SESSION_MANAGER`, and
`XDG_SESSION_TYPE=wayland` leak into child processes, causing XFCE components, VNC
servers, and Snap applications to fail. A dedicated user has none of these set, so
everything works cleanly.

## 6. Create the VNC desktop systemd service

The VNC server uses `vncserver` which forks a daemon process, so it needs systemd's `Type=forking`.

Create `/etc/systemd/system/naisys-desktop.service`:

```ini
[Unit]
Description=NAISYS VNC Desktop
After=network.target

[Service]
Type=forking
User=naisys
Group=naisys

Environment=HOME=/home/naisys
Environment=XDG_RUNTIME_DIR=/run/user/1001
Environment=XAUTHORITY=/home/naisys/.Xauthority

ExecStartPre=+/bin/bash -c 'mkdir -p /run/user/1001 && chown naisys:naisys /run/user/1001'
ExecStart=/usr/bin/vncserver :2 -geometry 1600x900 -localhost yes -AcceptSetDesktopSize=0
ExecStop=/usr/bin/vncserver -kill :2

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Note:** The `+` prefix on `ExecStartPre` runs that command as root, which is needed
to create the runtime directory. Adjust the UID (`1001`) to match the naisys user's
actual UID (`id -u naisys`).

### Fixed resolution

- `-geometry 1600x900` sets the framebuffer size. Change it to whatever you want the
  agent's screen to be (e.g. `1920x1080`). All modes xrandr advertises are available;
  this flag just picks the startup/default one.
- `-AcceptSetDesktopSize=0` tells `Xtigervnc` to reject `SetDesktopSize` requests from
  connecting viewers. Without it, TigerVNC auto-resizes the framebuffer to match the
  client window, which means `scrot` / `import -window root` screenshots will change
  size whenever someone connects, disconnects, or resizes their viewer — and won't
  match what a headless run captures. With it, the framebuffer stays pinned at the
  geometry above regardless of viewer state (the viewer letterboxes/scales instead).

Verify from the naisys session:

```bash
sudo -u naisys DISPLAY=:2 XAUTHORITY=/home/naisys/.Xauthority xrandr | head -3
# Screen 0: ... current 1600 x 900 ...
```

## 7. Enable and start the desktop

```bash
sudo systemctl daemon-reload
sudo systemctl enable naisys-desktop
sudo systemctl start naisys-desktop
```

## 8. Start the NAISYS agent with pm2

As the naisys user:

```bash
sudo su - naisys
cd client
npm install -g pm2
pm2 start npx --name naisys-client -- naisys --hub=<hub-url>
pm2 startup   # enable start on boot (one-time sudo)
pm2 save
```

## 9. Connect via VNC

From the host machine:

```bash
vncviewer localhost:5902
```

Display `:2` maps to port `5902` (5900 + display number).

## Managing the desktop service

```bash
# Check status
sudo systemctl status naisys-desktop

# Restart
sudo systemctl restart naisys-desktop

# Stop
sudo systemctl stop naisys-desktop
```
