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

## 3. Install NAISYS

```bash
sudo npm install -g naisys
```

## 4. Create the naisys user

```bash
sudo adduser --disabled-password --gecos "NAISYS Agent" naisys
echo "naisys:naisys" | sudo chpasswd
```

## 5. Configure the .env file

Create the NAISYS `.env` file in the naisys user's home directory:

```bash
sudo -u naisys tee /home/naisys/.env << EOF
NAISYS_FOLDER=~
HUB_ACCESS_KEY=<your-hub-access-token>
EOF
```

## 6. Configure VNC

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

## 7. Create systemd services

### VNC Desktop Service

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
ExecStart=/usr/bin/vncserver :2 -geometry 1920x1080 -localhost yes
ExecStop=/usr/bin/vncserver -kill :2

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Note:** The `+` prefix on `ExecStartPre` runs that command as root, which is needed
to create the runtime directory. Adjust the UID (`1001`) to match the naisys user's
actual UID (`id -u naisys`).

### NAISYS Agent Service

Create `/etc/systemd/system/naisys-agent.service`:

```ini
[Unit]
Description=NAISYS Agent
After=naisys-desktop.service
Requires=naisys-desktop.service

[Service]
Type=simple
User=naisys
Group=naisys

Environment=HOME=/home/naisys
Environment=DISPLAY=:2
Environment=XDG_SESSION_TYPE=x11
Environment=XDG_RUNTIME_DIR=/run/user/1001
Environment=XAUTHORITY=/home/naisys/.Xauthority
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
WorkingDirectory=/home/naisys

ExecStart=/usr/bin/naisys --hub="<hub url>"

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Notes:**
- `PATH` must be set explicitly — systemd services get a minimal PATH that may not
  include directories where tools like `scrot` are installed.
- `Restart=always` is used instead of `on-failure` because NAISYS exits cleanly
  (status 0) in some cases where it should be restarted.
- The agent service depends on the desktop service via `Requires` and `After`.

## 8. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable naisys-desktop naisys-agent
sudo systemctl start naisys-desktop
sudo systemctl start naisys-agent
```

## 9. Connect via VNC

From the host machine:

```bash
vncviewer localhost:5902
```

Display `:2` maps to port `5902` (5900 + display number).

## Managing the services

```bash
# Check status
sudo systemctl status naisys-desktop
sudo systemctl status naisys-agent

# View logs
sudo journalctl -u naisys-agent -f

# Restart
sudo systemctl restart naisys-desktop  # also restarts agent due to Requires=

# Stop
sudo systemctl stop naisys-agent
sudo systemctl stop naisys-desktop
```