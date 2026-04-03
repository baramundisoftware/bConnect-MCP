# SSL Certificate Verification Guide

**Project:** bConnect MCP Server
**Feature:** Enhanced SSL/TLS Certificate Verification
**Version:** Week 2 - Production Hardening
**Date:** January 29, 2025

---

## Overview

The bConnect MCP Server includes production-grade SSL/TLS certificate verification for all communications with the baramundi Management Suite API. This guide covers the recommended setup path for the most common deployment scenario — a baramundi server that uses a self-signed or internal CA certificate — and documents all other supported SSL options.

**Quickest path for most operators:** export the baramundi server CA cert, set `BCONNECT_CA_CERT_PATH` in `.env`, start the server, confirm no TLS errors. See [Using BCONNECT_CA_CERT_PATH](#using-bconnect_ca_cert_path) below.

---

## IMPORTANT: Never Disable TLS in Production

> **WARNING:** `NODE_TLS_REJECT_UNAUTHORIZED=0` disables ALL certificate validation.
> It makes every HTTPS connection vulnerable to man-in-the-middle attacks.
> It must never appear in a production `.env` file or any production configuration.
> Use `BCONNECT_CA_CERT_PATH` instead — it keeps full TLS validation while trusting your server's cert.

---

## Using BCONNECT_CA_CERT_PATH

`BCONNECT_CA_CERT_PATH` is an environment variable that points to a PEM-encoded CA certificate file on disk. When set, the MCP server loads the certificate at startup and passes it to every HTTPS request as a trusted CA. This is the correct solution for baramundi servers that use a self-signed certificate or an internal corporate CA.

How `src/index.ts` uses it:

```typescript
const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
const caCert = caCertPath ? fs.readFileSync(caCertPath, 'utf8') : undefined;

const bconnect = new BConnectClient({
  baseUrl,
  username,
  password,
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  ...(caCert && { ca: caCert })
});
```

If `BCONNECT_CA_CERT_PATH` is not set the server falls back to the system trust store, which is correct when the baramundi server has a certificate issued by a public CA.

---

## Step 1: Export the baramundi Management Server CA Certificate

Choose the export method that matches your workstation OS.

### Export on Windows

**Method A — Windows Certificate Manager (MMC)**

1. Open **Run** (`Win+R`), type `certmgr.msc`, press Enter.
2. Navigate to **Trusted Root Certification Authorities > Certificates** (or **Intermediate Certification Authorities > Certificates** if it is an intermediate CA).
3. Locate the certificate for your baramundi server CA. If you are not sure which it is, connect to `https://<bms-hostname>:<port>` in a browser, click the padlock, view the certificate chain, and note the root issuer name.
4. Right-click the CA certificate, select **All Tasks > Export**.
5. In the Export Wizard choose **Base-64 encoded X.509 (.CER)**, click Next.
6. Save to a known path, for example `C:\certs\bms-ca.cer`.
7. Rename the file extension to `.pem` — the content is already PEM-encoded:

```powershell
Rename-Item -Path "C:\certs\bms-ca.cer" -NewName "bms-ca.pem"
```

**Method B — PowerShell one-liner (server must be reachable)**

```powershell
# Replace hostname and port as needed
$hostname = "bms-win22srv"
$port     = 444

$tcpClient = [System.Net.Sockets.TcpClient]::new($hostname, $port)
$sslStream = [System.Net.Security.SslStream]::new($tcpClient.GetStream(), $false, { $true })
$sslStream.AuthenticateAsClient($hostname)
$cert      = $sslStream.RemoteCertificate
$sslStream.Close()
$tcpClient.Close()

$certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$pem = "-----BEGIN CERTIFICATE-----`n" +
       [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks) +
       "`n-----END CERTIFICATE-----"
$pem | Set-Content -Encoding ascii "C:\certs\bms-ca.pem"
Write-Host "Certificate exported to C:\certs\bms-ca.pem"
```

> Note: this exports the leaf certificate, which works for self-signed certs. For a CA-signed cert, export the issuing CA cert from MMC instead (Method A).

**Method C — certutil (built-in Windows tool)**

```powershell
# Export the root CA that signed the baramundi cert
certutil -ca.cert "C:\certs\bms-ca.cer"
certutil -encode "C:\certs\bms-ca.cer" "C:\certs\bms-ca.pem"
```

---

### Export on Linux / macOS

**Method A — openssl s_client (recommended)**

```bash
# Replace hostname and port as needed
openssl s_client -showcerts -connect bms-win22srv:444 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > /etc/ssl/certs/bms-ca.pem

# Verify the file looks correct
openssl x509 -in /etc/ssl/certs/bms-ca.pem -noout -subject -issuer -dates
```

If the server uses an intermediate CA, capture the full chain instead:

```bash
# Save the full chain (all certs)
openssl s_client -showcerts -connect bms-win22srv:444 </dev/null 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /etc/ssl/certs/bms-ca-chain.pem
```

**Method B — Browser export then copy to Linux**

1. In Firefox or Chrome, navigate to `https://bms-win22srv:444`.
2. Click the padlock > Certificate > Details > Export / Save to File.
3. Choose PEM format and save as `bms-ca.pem`.
4. Copy the file to the Linux host:

```bash
scp user@workstation:/path/to/bms-ca.pem /etc/ssl/certs/bms-ca.pem
```

**Method C — From system certificate store (if already trusted)**

```bash
# Debian/Ubuntu
cp /usr/local/share/ca-certificates/bms-ca.crt /etc/ssl/certs/bms-ca.pem

# RHEL/CentOS
cp /etc/pki/ca-trust/source/anchors/bms-ca.crt /etc/ssl/certs/bms-ca.pem
```

---

## Step 2: Set BCONNECT_CA_CERT_PATH in .env

Open (or create) the `.env` file in the project root and add `BCONNECT_CA_CERT_PATH`. Use an absolute path.

```bash
# bConnect API Configuration
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password

# Path to PEM-encoded CA certificate that signed the baramundi server cert.
# Use an absolute path. The file must be readable by the process user.
BCONNECT_CA_CERT_PATH=/etc/ssl/certs/bms-ca.pem

# DEVELOPMENT ONLY — NEVER USE IN PRODUCTION:
# NODE_TLS_REJECT_UNAUTHORIZED=0
```

Windows example:

```ini
BCONNECT_CA_CERT_PATH=C:\certs\bms-ca.pem
```

Docker / Kubernetes: mount the PEM file as a volume or secret and set the path accordingly:

```bash
BCONNECT_CA_CERT_PATH=/run/secrets/bms-ca.pem
```

---

## Step 3: Verify TLS Is Working

### Quick smoke test (no real server needed for cert loading check)

```bash
# Build the project
npm run build

# Confirm the cert file is readable and valid PEM
openssl x509 -in /etc/ssl/certs/bms-ca.pem -noout -subject -issuer -dates
```

### Start the server and watch for TLS errors

```bash
node build/index.js
```

A successful startup produces no TLS-related errors. If the CA cert is wrong or the file is missing you will see one of the following at startup or on first API call:

| Error code | Meaning | Fix |
|------------|---------|-----|
| `ENOENT` | `BCONNECT_CA_CERT_PATH` points to a non-existent file | Check the path |
| `SELF_SIGNED_CERT_IN_CHAIN` | CA cert not trusted | Export the correct issuing CA |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Cert chain incomplete | Export the full chain (see Method A Linux) |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Hostname mismatch | Use the hostname that matches the cert CN/SAN |

### Test with curl before starting the server

```bash
# Should return HTTP 200 or a JSON response — no TLS error
curl --cacert /etc/ssl/certs/bms-ca.pem \
     -u "your-username:your-password" \
     https://bms-win22srv:444/bconnect/api/v2.0/endpoints

# If curl succeeds, the same cert file will work with BCONNECT_CA_CERT_PATH
```

### Test with Node.js directly

```bash
node - <<'EOF'
const https = require('https');
const fs    = require('fs');

const options = {
  hostname: 'bms-win22srv',
  port: 444,
  path: '/bconnect/api/v2.0/endpoints',
  method: 'GET',
  ca: fs.readFileSync('/etc/ssl/certs/bms-ca.pem'),
  headers: {
    Authorization: 'Basic ' + Buffer.from('username:password').toString('base64')
  }
};

const req = https.request(options, (res) => {
  console.log('TLS OK — HTTP status:', res.statusCode);
});
req.on('error', (e) => {
  console.error('TLS FAILED:', e.message);
});
req.end();
EOF
```

`TLS OK — HTTP status: 200` confirms the CA cert is correct and `BCONNECT_CA_CERT_PATH` will work.

---

## Security by Default

**Default Behavior:** SSL certificate verification is **ENABLED by default** for maximum security.

```typescript
// Secure by default - certificates are verified
const client = new BConnectClient({
  baseUrl: 'https://bms-win22srv:444/bconnect',
  username: 'Administrator',
  password: 'your-password'
});
// ✅ Will reject self-signed or untrusted certificates
```

---

## SSL Configuration Options

### Basic Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rejectUnauthorized` | `boolean` | `true` | Reject untrusted certificates |
| `ca` | `string \| Buffer \| Array` | undefined | Custom CA certificate(s) |
| `cert` | `string \| Buffer` | undefined | Client certificate (mutual TLS) |
| `key` | `string \| Buffer` | undefined | Client private key (mutual TLS) |
| `passphrase` | `string` | undefined | Passphrase for encrypted private key |
| `checkServerIdentity` | `function` | undefined | Custom hostname validation |

---

## Common Scenarios

### Scenario 1: Production with Valid Certificate

**Use Case:** baramundi server has a valid certificate from a trusted CA (e.g., Let's Encrypt, DigiCert)

```typescript
const client = new BConnectClient({
  baseUrl: 'https://bms.company.com:444/bconnect',
  username: 'api-user',
  password: process.env.BCONNECT_PASSWORD
  // No SSL options needed - default verification works!
});
```

**Security:** ✅ **Highest** - Full certificate chain validation

---

### Scenario 2: Self-Signed Certificate

**Use Case:** baramundi server uses a self-signed certificate (common in internal deployments)

**Option A: Provide Custom CA Certificate (Recommended)**

```typescript
import fs from 'fs';

const client = new BConnectClient({
  baseUrl: 'https://bms-win22srv:444/bconnect',
  username: 'Administrator',
  password: process.env.BCONNECT_PASSWORD,

  // Load self-signed CA certificate
  ca: fs.readFileSync('/path/to/ca-certificate.pem')
});
```

**Option B: Multiple CA Certificates**

```typescript
const client = new BConnectClient({
  baseUrl: 'https://bms-win22srv:444/bconnect',
  username: 'Administrator',
  password: process.env.BCONNECT_PASSWORD,

  // Load multiple CA certificates
  ca: [
    fs.readFileSync('/path/to/root-ca.pem'),
    fs.readFileSync('/path/to/intermediate-ca.pem')
  ]
});
```

**Security:** ✅ **High** - Certificate verified against custom CA

---

### Scenario 3: Corporate CA Certificate

**Use Case:** baramundi server certificate is issued by corporate internal CA

```typescript
import fs from 'fs';

const client = new BConnectClient({
  baseUrl: 'https://bms.internal.company.com:444/bconnect',
  username: 'api-user',
  password: process.env.BCONNECT_PASSWORD,

  // Corporate CA certificate
  ca: fs.readFileSync('/etc/ssl/certs/company-root-ca.pem')
});
```

**Security:** ✅ **High** - Certificate verified against corporate CA

---

### Scenario 4: Development/Testing Only (Insecure)

**Use Case:** Local development, testing, demo environments

```typescript
const client = new BConnectClient({
  baseUrl: 'https://localhost:444/bconnect',
  username: 'admin',
  password: 'test-password',

  // ⚠️ INSECURE: Disable certificate verification
  rejectUnauthorized: false
});
```

**Security:** ❌ **NONE** - Vulnerable to man-in-the-middle attacks

**⚠️ WARNING:** **NEVER** use `rejectUnauthorized: false` in production!

---

### Scenario 5: Mutual TLS (Client Certificate Authentication)

**Use Case:** baramundi server requires client certificates for authentication

```typescript
import fs from 'fs';

const client = new BConnectClient({
  baseUrl: 'https://bms-secure.company.com:444/bconnect',
  username: 'api-user',
  password: process.env.BCONNECT_PASSWORD,

  // Server CA certificate
  ca: fs.readFileSync('/path/to/server-ca.pem'),

  // Client certificate and key
  cert: fs.readFileSync('/path/to/client-cert.pem'),
  key: fs.readFileSync('/path/to/client-key.pem'),

  // Passphrase if private key is encrypted
  passphrase: process.env.CLIENT_KEY_PASSPHRASE
});
```

**Security:** ✅ **Highest** - Mutual authentication (both server and client verified)

---

### Scenario 6: Custom Hostname Validation

**Use Case:** Server certificate has different hostname than the URL

```typescript
const client = new BConnectClient({
  baseUrl: 'https://192.168.1.100:444/bconnect',
  username: 'Administrator',
  password: process.env.BCONNECT_PASSWORD,

  ca: fs.readFileSync('/path/to/ca.pem'),

  // Custom hostname check (certificate is for 'bms.company.com')
  checkServerIdentity: (hostname, cert) => {
    if (cert.subject.CN !== 'bms.company.com') {
      return new Error(`Certificate CN mismatch: expected bms.company.com, got ${cert.subject.CN}`);
    }
    return undefined; // Valid
  }
});
```

**Security:** ✅ **High** - Custom validation logic

---

## Environment Variable Configuration

**Recommended:** Store certificates and keys as environment variables for security

### Using Environment Variables

```typescript
import fs from 'fs';

const client = new BConnectClient({
  baseUrl: process.env.BCONNECT_BASE_URL!,
  username: process.env.BCONNECT_USERNAME!,
  password: process.env.BCONNECT_PASSWORD!,

  // Load CA certificate from environment or file
  ca: process.env.BCONNECT_CA_CERT ||
      fs.readFileSync(process.env.BCONNECT_CA_CERT_PATH!)
});
```

### Environment Variables (.env)

```bash
# bConnect API Configuration
BCONNECT_BASE_URL=https://bms.company.com:444/bconnect
BCONNECT_USERNAME=api-user
BCONNECT_PASSWORD=secure-password-here

# SSL Configuration
BCONNECT_CA_CERT_PATH=/etc/ssl/certs/company-ca.pem
# OR: BCONNECT_CA_CERT="-----BEGIN CERTIFICATE-----\n..."

# Optional: Client Certificate (Mutual TLS)
BCONNECT_CLIENT_CERT_PATH=/etc/ssl/certs/client-cert.pem
BCONNECT_CLIENT_KEY_PATH=/etc/ssl/private/client-key.pem
BCONNECT_CLIENT_KEY_PASSPHRASE=key-passphrase-here
```

---

## How to Obtain Certificates

### Self-Signed Certificate from baramundi Server

**Option 1: Export from Browser**
1. Open `https://bms-win22srv:444` in browser
2. Click padlock icon → Certificate → Details → Export
3. Save as `bms-ca.pem`
4. Use `ca: fs.readFileSync('/path/to/bms-ca.pem')`

**Option 2: Using OpenSSL**
```bash
# Download certificate chain
openssl s_client -showcerts -connect bms-win22srv:444 </dev/null 2>/dev/null | \
  openssl x509 -outform PEM > bms-ca.pem
```

**Option 3: Using curl**
```bash
# Extract certificate
curl -k -v https://bms-win22srv:444 2>&1 | \
  sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > bms-ca.pem
```

### Corporate CA Certificate

**Option 1: From System Certificate Store (Windows)**
```powershell
# Export corporate root CA
certutil -ca.cert corporate-root-ca.cer
certutil -encode corporate-root-ca.cer corporate-root-ca.pem
```

**Option 2: From System Certificate Store (Linux)**
```bash
# Usually located in /etc/ssl/certs/ or /usr/share/ca-certificates/
cp /etc/ssl/certs/company-root-ca.crt ./company-ca.pem
```

**Option 3: From IT Security Team**
- Contact your IT security team
- Request internal CA certificate (PEM format)

---

## MCP Server Configuration

### For MCP Server with Environment Variables

Update `.env`:
```bash
BCONNECT_BASE_URL=https://bms.company.com:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=your-password

# SSL Certificate (choose one):
# Option 1: File path
BCONNECT_CA_CERT_PATH=/path/to/ca-certificate.pem

# Option 2: Inline PEM (for Docker/Kubernetes secrets)
BCONNECT_CA_CERT="-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKL...
(full certificate here)
...
-----END CERTIFICATE-----"

# Optional: Disable verification for development ONLY
# BCONNECT_REJECT_UNAUTHORIZED=false  # ⚠️ INSECURE - DO NOT USE IN PRODUCTION
```

### Update MCP Server Code (src/index.ts)

```typescript
import fs from 'fs';

// Load CA certificate from environment
let ca: string | undefined;
if (process.env.BCONNECT_CA_CERT) {
  // Inline PEM certificate
  ca = process.env.BCONNECT_CA_CERT;
} else if (process.env.BCONNECT_CA_CERT_PATH) {
  // Load from file
  ca = fs.readFileSync(process.env.BCONNECT_CA_CERT_PATH, 'utf8');
}

const client = new BConnectClient({
  baseUrl: process.env.BCONNECT_BASE_URL!,
  username: process.env.BCONNECT_USERNAME!,
  password: process.env.BCONNECT_PASSWORD!,

  // SSL Configuration
  rejectUnauthorized: process.env.BCONNECT_REJECT_UNAUTHORIZED !== 'false',
  ca: ca
});
```

---

## Testing SSL Configuration

### Test 1: Verify Certificate Validation Works

```typescript
import { BConnectClient } from './bconnect-client.js';

async function testSSL() {
  try {
    const client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'password'
      // No CA provided, no rejectUnauthorized=false
    });

    await client.endpoints.getWindowsEndpoints({});
    console.log('✅ SSL verification PASSED (trusted certificate)');
  } catch (error) {
    if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
      console.log('⚠️  Self-signed certificate detected');
      console.log('👉 Add ca: option with server certificate');
    } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      console.log('⚠️  Untrusted certificate authority');
      console.log('👉 Add ca: option with CA certificate');
    } else {
      console.error('❌ SSL error:', error.message);
    }
  }
}

testSSL();
```

### Test 2: Verify Custom CA Works

```typescript
import fs from 'fs';

async function testCustomCA() {
  const client = new BConnectClient({
    baseUrl: 'https://bms-win22srv:444/bconnect',
    username: 'Administrator',
    password: 'password',
    ca: fs.readFileSync('/path/to/ca-cert.pem')
  });

  try {
    await client.endpoints.getWindowsEndpoints({});
    console.log('✅ Custom CA verification PASSED');
  } catch (error) {
    console.error('❌ Custom CA verification FAILED:', error.message);
  }
}

testCustomCA();
```

---

## Security Best Practices

### ✅ DO

1. **Always use certificate verification in production**
   - Default behavior (no `rejectUnauthorized: false`)

2. **Use custom CA certificates for self-signed certificates**
   - Provides security without disabling verification

3. **Store certificates securely**
   - Environment variables, Kubernetes secrets, Azure Key Vault

4. **Use mutual TLS (client certificates) for critical systems**
   - Highest level of authentication

5. **Rotate certificates regularly**
   - Follow your organization's certificate lifecycle policy

6. **Monitor certificate expiration**
   - Set up alerts before certificates expire

### ❌ DON'T

1. **Never use `rejectUnauthorized: false` in production**
   - Exposes to man-in-the-middle attacks

2. **Never commit certificates to source control**
   - Use environment variables or secret management

3. **Never share private keys**
   - Each environment should have its own client certificate

4. **Never ignore certificate errors**
   - Investigate and fix root cause

---

## Troubleshooting

### Error: SELF_SIGNED_CERT_IN_CHAIN

**Cause:** Server uses a self-signed certificate

**Solution:**
```typescript
ca: fs.readFileSync('/path/to/server-certificate.pem')
```

---

### Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE

**Cause:** Certificate signed by unknown CA

**Solution:**
```typescript
ca: fs.readFileSync('/path/to/ca-certificate.pem')
```

---

### Error: Hostname/IP doesn't match certificate's altnames

**Cause:** Accessing server by IP address when certificate is for hostname

**Solution:**
```typescript
checkServerIdentity: () => undefined  // Disable hostname check (less secure)
```

**Better Solution:** Access server by the hostname in the certificate

---

### Error: DEPTH_ZERO_SELF_SIGNED_CERT

**Cause:** Self-signed certificate with no CA

**Solution:**
```typescript
ca: fs.readFileSync('/path/to/self-signed-cert.pem')
```

---

## Migration from Insecure Configuration

### Before (Insecure)

```typescript
// ❌ INSECURE - DO NOT USE
const client = new BConnectClient({
  baseUrl: 'https://bms-win22srv:444/bconnect',
  username: 'Administrator',
  password: 'password',
  rejectUnauthorized: false  // Disabled verification
});
```

### After (Secure)

```typescript
// ✅ SECURE - Recommended
import fs from 'fs';

const client = new BConnectClient({
  baseUrl: 'https://bms-win22srv:444/bconnect',
  username: 'Administrator',
  password: 'password',
  ca: fs.readFileSync('/path/to/bms-ca-cert.pem')
});
```

---

## Summary

The bConnect MCP Server now provides **enterprise-grade SSL/TLS certificate verification** with support for:

- ✅ **Secure by default** - Certificate verification enabled
- ✅ **Custom CA certificates** - Self-signed and corporate certificates
- ✅ **Mutual TLS** - Client certificate authentication
- ✅ **Flexible configuration** - File-based or environment-variable-based
- ✅ **Production-ready** - No insecure defaults

**Next Steps:**
1. Obtain your server's CA certificate
2. Update configuration with `ca:` option
3. Remove any `rejectUnauthorized: false` settings
4. Test connection to verify SSL validation works
5. Deploy to production with secure SSL configuration

---

**Implemented by:** Claude Code
**Originally created:** January 29, 2025
**Last updated:** 2026-03-23 — Added BCONNECT_CA_CERT_PATH setup guide (Steps 1-3)
**Production Ready:** Yes
