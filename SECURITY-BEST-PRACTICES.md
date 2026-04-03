# bConnect MCP Server - Security Best Practices

**Document Version:** 1.0
**Last Updated:** November 4, 2025
**Applies To:** bConnect MCP Server v1.0+

---

## Table of Contents

1. [Overview](#overview)
2. [SSL/TLS Configuration](#ssltls-configuration)
3. [Credential Management](#credential-management)
4. [Authentication & Authorization](#authentication--authorization)
5. [Audit Logging](#audit-logging)
6. [Rate Limiting](#rate-limiting)
7. [Network Security](#network-security)
8. [Input Validation](#input-validation)
9. [Production Deployment Checklist](#production-deployment-checklist)
10. [Security Monitoring](#security-monitoring)
11. [Incident Response](#incident-response)

---

## Overview

The bConnect MCP Server provides programmatic access to the baramundi Management Suite API. Following security best practices is essential to protect sensitive data and prevent unauthorized access.

**Security Priorities:**
1. **Confidentiality:** Protect credentials, BitLocker keys, TPM passwords
2. **Integrity:** Validate all inputs, prevent injection attacks
3. **Availability:** Rate limit requests, handle errors gracefully
4. **Auditability:** Log all security-sensitive operations

**Threat Model:**
- Credential theft from configuration files
- Man-in-the-middle attacks (unverified SSL)
- Unauthorized API access
- Data leakage through logs
- Denial of service through excessive requests

---

## SSL/TLS Configuration

### Development vs Production

**❌ NEVER use in production:**
```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```
This disables SSL certificate verification and allows man-in-the-middle attacks!

### Production SSL Configuration

**Option 1: Use Valid Certificates (Recommended)**

1. **Obtain valid SSL certificate for baramundi server:**
   - From trusted CA (e.g., Let's Encrypt, internal PKI)
   - Certificate must match server hostname
   - Must include full certificate chain

2. **Configure environment:**
   ```env
   # Enable SSL verification (default behavior)
   # NODE_TLS_REJECT_UNAUTHORIZED=1  # Optional, 1 is default

   # If using internal CA, provide CA certificate
   NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem
   ```

3. **Verify SSL configuration:**
   ```bash
   # Test SSL connection
   openssl s_client -connect bms-server:444 -showcerts

   # Should show: Verify return code: 0 (ok)
   ```

**Option 2: Certificate Pinning (High Security)**

Pin specific certificate to prevent MITM even with compromised CA:

```typescript
// Custom HTTPS agent with certificate pinning
import https from 'https';
import fs from 'fs';

const expectedFingerprint = 'AA:BB:CC:...'; // SHA256 fingerprint

const agent = new https.Agent({
  checkServerIdentity: (host, cert) => {
    const fingerprint = cert.fingerprint256;
    if (fingerprint !== expectedFingerprint) {
      throw new Error(`Certificate mismatch! Expected: ${expectedFingerprint}, Got: ${fingerprint}`);
    }
  }
});

// Use this agent with axios
```

**Option 3: Custom CA Certificate (Internal PKI)**

For organizations with internal certificate authority:

```bash
# Export CA certificate from baramundi server
# Windows: certmgr.msc → Trusted Root → Export as Base64 .cer

# Convert to PEM if needed
openssl x509 -inform DER -in ca-cert.cer -out ca-cert.pem

# Configure Node.js
export NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem
```

### SSL Troubleshooting

**Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE**
- Certificate chain incomplete
- Solution: Ensure full certificate chain is installed on server

**Error: DEPTH_ZERO_SELF_SIGNED_CERT**
- Self-signed certificate without custom CA
- Solution: Add certificate to trusted CAs or use Option 3 above

**Error: CERT_HAS_EXPIRED**
- Certificate expired
- Solution: Renew certificate on baramundi server

---

## Credential Management

### Secure Credential Storage

**❌ BAD: Hardcoded credentials**
```typescript
const client = new BConnectClient({
  baseURL: 'https://server:444/bconnect',
  username: 'Administrator',  // ❌ Never hardcode!
  password: 'Password123'     // ❌ Security risk!
});
```

**✅ GOOD: Environment variables**
```env
BCONNECT_BASE_URL=https://bms-server:444/bconnect
BCONNECT_USERNAME=api-service-account
BCONNECT_PASSWORD=<strong-password>
```

```typescript
const client = new BConnectClient({
  baseURL: process.env.BCONNECT_BASE_URL!,
  username: process.env.BCONNECT_USERNAME!,
  password: process.env.BCONNECT_PASSWORD!
});
```

### File Permissions

Protect `.env` file with strict permissions:

```bash
# Set ownership to MCP server user only
chown mcp-user:mcp-user .env

# Remove all permissions for group and others
chmod 600 .env

# Verify
ls -la .env
# Should show: -rw------- 1 mcp-user mcp-user
```

**Never commit `.env` to version control:**
```bash
# .gitignore
.env
.env.*
!.env.example
```

### Credential Rotation

**Recommended: Rotate credentials every 90 days**

```bash
#!/bin/bash
# rotate-credentials.sh

# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# 2. Update in baramundi console
# (Manual step or via API if supported)

# 3. Update .env
sed -i "s/BCONNECT_PASSWORD=.*/BCONNECT_PASSWORD=$NEW_PASSWORD/" .env

# 4. Restart MCP server
systemctl restart bconnect-mcp-server

# 5. Test connectivity
curl -k -u "api-user:$NEW_PASSWORD" "https://server:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

### Service Accounts

**Best Practice: Dedicated API service account**

1. **Create dedicated user in baramundi:**
   - Name: `bconnect-mcp-service`
   - Description: "MCP Server API Access"
   - Strong password (32+ characters)

2. **Assign minimum required permissions:**
   - Read-only for queries
   - Write permissions only for required operations
   - No console access
   - No interactive login

3. **Disable unused features:**
   - No VPN access
   - No RDP access
   - API access only

---

## Authentication & Authorization

### Authentication Methods

**Current: Basic Authentication (Username + Password)**

```http
Authorization: Basic <base64-encoded-username:password>
```

**Future: OAuth 2.0 / JWT Tokens (if supported by baramundi)**

When available, prefer token-based authentication:
- Shorter token lifetime (1-24 hours)
- Revocable without password change
- Scoped permissions per token

### Authorization Best Practices

1. **Principle of Least Privilege:**
   - Grant minimum permissions needed
   - Read-only by default
   - Write permissions only when required

2. **Separate accounts by function:**
   - `bconnect-mcp-readonly`: Query operations only
   - `bconnect-mcp-write`: Write operations
   - `bconnect-mcp-admin`: Administrative tasks

3. **Audit permissions regularly:**
   ```bash
   # Review current permissions
   # Check baramundi console: Security → Users → bconnect-mcp-service
   ```

---

## Audit Logging

### Enable Comprehensive Logging

**Configure audit logging in `.env`:**
```env
# Log all operations
BCONNECT_AUDIT_LEVEL=all

# Or security-sensitive operations only
BCONNECT_AUDIT_LEVEL=security

# Or write operations only
BCONNECT_AUDIT_LEVEL=write

# Disable logging (not recommended for production)
BCONNECT_AUDIT_LEVEL=none
```

### Audit Log Format

```json
{
  "timestamp": "2025-11-04T10:15:30.123Z",
  "user": "bconnect-mcp-service",
  "operation": "GET /Endpoints/{id}",
  "method": "GET",
  "url": "https://server:444/bconnect/endpoints/v2.0/Endpoints/abc-123",
  "statusCode": 200,
  "duration": 45,
  "parameters": { "id": "abc-123" },
  "clientIP": "192.168.1.100",
  "userAgent": "bconnect-mcp-server/1.0"
}
```

### Security-Sensitive Operations

**Always log these operations:**
- BitLocker recovery key access (`[SECURITY AUDIT]` prefix)
- TPM owner password retrieval
- Credential/secret access
- User creation/modification
- Permission changes
- Bulk operations
- Failed authentication attempts

**Example security log:**
```
[SECURITY AUDIT] BitLocker recovery key accessed for endpoint bms-win22srv by user bconnect-mcp-service at 2025-11-04 10:15:30
```

### Log Management

**Log rotation (daily):**
```bash
# /etc/logrotate.d/bconnect-mcp
/var/log/bconnect-mcp/*.log {
    daily
    rotate 90
    compress
    delaycompress
    notifempty
    create 0640 mcp-user mcp-user
    sharedscripts
    postrotate
        systemctl reload bconnect-mcp-server
    endscript
}
```

**Centralized logging (recommended):**
- Forward logs to Splunk, ELK, or similar
- Enable alerts for security events
- Retain logs for compliance period (typically 1-7 years)

### Log Review

**Review logs weekly for:**
- Failed authentication attempts
- Unusual access patterns
- Large bulk operations
- After-hours access
- Access from unusual IPs
- BitLocker key access

---

## Rate Limiting

### Configure Rate Limits

**Prevent abuse and DoS attacks:**

```env
# Maximum requests per minute (default: 100)
BCONNECT_RATE_LIMIT_MAX_REQUESTS=100

# Time window in milliseconds (default: 60000 = 1 minute)
BCONNECT_RATE_LIMIT_WINDOW_MS=60000

# Enable rate limiting (default: false for backward compatibility)
BCONNECT_RATE_LIMIT_ENABLED=true

# Custom error message
BCONNECT_RATE_LIMIT_MESSAGE="Rate limit exceeded. Please slow down your requests."
```

### Rate Limiting Strategy

**Token Bucket Algorithm (implemented):**
- Smooth rate limiting with burst capacity
- Allows temporary spikes within limit
- Automatic token regeneration
- Fair resource allocation

**Response headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1730725530
```

### Handling Rate Limits

**Client-side backoff:**
```typescript
async function withRetry(operation: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error.code === 429 && i < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

---

## Network Security

### Firewall Configuration

**Inbound rules (MCP server):**
```bash
# Allow only from Claude Code host
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp

# Or allow from localhost only (if Claude Code runs on same host)
sudo ufw allow from 127.0.0.1 to any port 3000 proto tcp
```

**Outbound rules (MCP server):**
```bash
# Allow only to baramundi server
sudo ufw allow out to 192.168.1.50 port 444 proto tcp

# Allow DNS
sudo ufw allow out 53/udp

# Deny all other outbound by default
sudo ufw default deny outgoing
```

### Network Segmentation

**Recommended network architecture:**
```
[Claude Code] → [MCP Server] → [baramundi Server]
   DMZ          Internal Net      Management Net
```

- MCP server in isolated network segment
- No direct internet access
- Firewall between segments
- VPN for remote access

### VPN/Tunnel Access

**For remote Claude Code clients:**
```bash
# Option 1: WireGuard VPN
wg-quick up wg0

# Option 2: SSH tunnel
ssh -L 3000:localhost:3000 user@mcp-server

# Option 3: TLS mutual authentication
# Configure client certificates for MCP server
```

---

## Input Validation

### Current Implementation

**✅ Comprehensive input validation implemented (100% coverage)**

All 117 MCP tools validate:
- **Required parameters:** Missing parameters rejected
- **Type validation:** String, number, boolean, GUID, etc.
- **Format validation:** GUID format, email, URL, ISO dates
- **Range validation:** Min/max for numbers, length for strings
- **Enum validation:** Allowed values checked
- **Pattern validation:** Custom regex patterns

**Example validation rules:**
```typescript
{
  name: 'id',
  required: true,
  type: 'string',
  format: 'guid',
  errorMessage: 'Invalid endpoint ID format'
}
```

### Security Benefits

**Protection against:**
- SQL injection (parameterized queries)
- Command injection (validated GUIDs only)
- Path traversal (no file paths accepted)
- XSS (output encoding in Claude Code)
- DoS (length limits on all inputs)

### Custom Validation Rules

**Add custom rules for business logic:**
```typescript
// Example: Restrict endpoint deletion to test environments
if (tool === 'delete_endpoint' && !isTestEnvironment()) {
  throw new McpError(
    ErrorCode.InvalidParams,
    'Endpoint deletion not allowed in production'
  );
}
```

---

## Production Deployment Checklist

### Pre-Deployment Security Review

- [ ] **SSL/TLS:**
  - [ ] Valid SSL certificate installed on baramundi server
  - [ ] `NODE_TLS_REJECT_UNAUTHORIZED=0` removed from `.env`
  - [ ] CA certificate configured if using internal PKI
  - [ ] SSL connection tested and verified

- [ ] **Credentials:**
  - [ ] Service account created with minimum permissions
  - [ ] Strong password (32+ characters, random)
  - [ ] `.env` file permissions set to 600
  - [ ] `.env` excluded from version control
  - [ ] Credential rotation schedule established

- [ ] **Authentication & Authorization:**
  - [ ] Service account has minimum required permissions
  - [ ] Read-only account used for queries
  - [ ] Separate accounts for read/write operations
  - [ ] Interactive login disabled for service accounts

- [ ] **Audit Logging:**
  - [ ] Audit logging enabled (`BCONNECT_AUDIT_LEVEL=all`)
  - [ ] Log rotation configured
  - [ ] Centralized logging configured (Splunk/ELK)
  - [ ] Alerts configured for security events
  - [ ] Log review process established

- [ ] **Rate Limiting:**
  - [ ] Rate limiting enabled
  - [ ] Appropriate limits configured for workload
  - [ ] Rate limit monitoring in place

- [ ] **Network Security:**
  - [ ] Firewall rules configured (inbound + outbound)
  - [ ] Network segmentation implemented
  - [ ] VPN/tunnel for remote access
  - [ ] No direct internet exposure

- [ ] **Input Validation:**
  - [ ] All 117 tools have input validation
  - [ ] Custom business logic validation added
  - [ ] Validation tested with fuzzing

- [ ] **Monitoring:**
  - [ ] Health checks configured
  - [ ] Performance monitoring enabled
  - [ ] Error tracking configured
  - [ ] Security event monitoring active

- [ ] **Incident Response:**
  - [ ] Incident response plan documented
  - [ ] Contact list updated
  - [ ] Escalation procedures defined
  - [ ] Backup and recovery tested

### Post-Deployment Verification

```bash
#!/bin/bash
# security-check.sh

echo "=== SSL Verification ==="
openssl s_client -connect bms-server:444 -showcerts | grep "Verify return code"

echo "=== Credential File Permissions ==="
ls -la .env

echo "=== Service Account Test ==="
curl -k -u "$BCONNECT_USERNAME:$BCONNECT_PASSWORD" \
  "https://bms-server:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

echo "=== Audit Log Check ==="
tail -20 /var/log/bconnect-mcp/audit.log

echo "=== Rate Limit Test ==="
for i in {1..5}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:3000/health"
done

echo "=== Firewall Rules ==="
sudo ufw status numbered
```

---

## Security Monitoring

### Key Metrics to Monitor

1. **Authentication:**
   - Failed login attempts per hour
   - Multiple failed attempts from same IP
   - Successful logins from unusual IPs

2. **Authorization:**
   - Permission denied errors
   - Unauthorized access attempts
   - Privilege escalation attempts

3. **API Usage:**
   - Requests per minute/hour
   - Unusual traffic spikes
   - Large bulk operations
   - After-hours activity

4. **Security-Sensitive Operations:**
   - BitLocker key access frequency
   - TPM password retrievals
   - Bulk endpoint modifications
   - User/permission changes

5. **Performance:**
   - Response times
   - Error rates
   - Memory/CPU usage
   - Rate limit hits

### Alerting Thresholds

**Critical alerts (immediate):**
- 10+ failed auth attempts in 5 minutes
- BitLocker key access outside business hours
- Bulk delete operations (>10 endpoints)
- SSL certificate errors
- Service downtime

**Warning alerts (15 min delay):**
- 5 failed auth attempts in 10 minutes
- Rate limit exceeded
- Slow response times (>5s average)
- High error rate (>5%)

**Info alerts (daily summary):**
- Total API calls
- Top users by activity
- Most used operations
- Error summary

### Monitoring Tools

**Recommended:**
- **Prometheus + Grafana:** Metrics and dashboards
- **ELK Stack:** Log aggregation and analysis
- **Splunk:** Enterprise SIEM
- **DataDog / New Relic:** APM and monitoring
- **PagerDuty / OpsGenie:** Alert management

---

## Incident Response

### Security Incident Types

1. **Credential Compromise:**
   - Indicators: Unusual access patterns, failed auth from unknown IPs
   - Response: Immediately rotate credentials, review audit logs

2. **Unauthorized Access:**
   - Indicators: Permission denied errors, access to unauthorized endpoints
   - Response: Revoke access, investigate scope, review permissions

3. **Data Exfiltration:**
   - Indicators: Large bulk queries, BitLocker key dumps, unusual downloads
   - Response: Block source IP, investigate compromised account, notify security team

4. **Denial of Service:**
   - Indicators: Rate limit exceeded, service unresponsive, resource exhaustion
   - Response: Enable rate limiting, block source IP, scale resources

### Incident Response Procedure

**Step 1: Detect & Contain (0-15 minutes)**
```bash
# 1. Identify compromised account
grep "SECURITY AUDIT" /var/log/bconnect-mcp/audit.log | tail -100

# 2. Disable account immediately
# (baramundi console or API if supported)

# 3. Block source IP
sudo ufw deny from <suspicious-ip>

# 4. Rotate credentials
./rotate-credentials.sh
```

**Step 2: Investigate (15-60 minutes)**
```bash
# 1. Review full audit log for compromised account
grep "user=compromised-account" /var/log/bconnect-mcp/audit.log

# 2. Identify accessed resources
grep "statusCode=200" audit.log | grep "user=compromised-account"

# 3. Check for data exfiltration
grep "BitLocker\|TPM\|Secret" audit.log | grep "user=compromised-account"

# 4. Identify attack vector
# Review authentication logs, access logs, network logs
```

**Step 3: Remediate (1-4 hours)**
- Revoke compromised credentials
- Reset affected user accounts
- Review and update permissions
- Patch vulnerabilities
- Update security controls

**Step 4: Document & Learn (1-2 days)**
- Create incident report
- Document timeline
- Identify root cause
- Update security controls
- Train team on lessons learned

### Contact List

**Security Team:**
- Security Operations Center (SOC): security@company.com
- Incident Response Team: ir@company.com
- CISO: ciso@company.com

**Technical Contacts:**
- MCP Server Admin: mcp-admin@company.com
- baramundi Admin: baramundi-admin@company.com
- Network Security: netsec@company.com

**Escalation:**
- Level 1: Team Lead (respond within 15 min)
- Level 2: Security Manager (respond within 30 min)
- Level 3: CISO (respond within 1 hour)

---

## Compliance & Regulations

### Data Protection

**GDPR Compliance:**
- Minimize personal data collection
- Secure credential storage
- Audit log retention (max 90 days for personal data)
- Right to erasure (delete audit logs on request)

**HIPAA Compliance (if applicable):**
- Encrypt data in transit (TLS 1.2+)
- Encrypt data at rest (baramundi responsibility)
- Access controls and audit logging
- Business Associate Agreement (BAA) with baramundi

### Industry Standards

**NIST Cybersecurity Framework:**
- Identify: Asset inventory, risk assessment
- Protect: Access controls, encryption, training
- Detect: Monitoring, logging, anomaly detection
- Respond: Incident response plan, communication
- Recover: Backup, disaster recovery, lessons learned

**ISO 27001:**
- Information security management system (ISMS)
- Risk assessment and treatment
- Security controls implementation
- Continuous improvement

---

## Security Maintenance

### Regular Security Tasks

**Daily:**
- Review security alert logs
- Check failed authentication attempts
- Monitor BitLocker key access

**Weekly:**
- Review full audit logs
- Check for security updates
- Test backup and recovery

**Monthly:**
- Review user permissions
- Update firewall rules
- Security training for team
- Vulnerability scanning

**Quarterly:**
- Credential rotation
- Security audit
- Penetration testing
- Incident response drill
- Update security documentation

---

## Additional Resources

**Internal Documentation:**
- USAGE-EXAMPLES.md - Usage examples for all tools
- TROUBLESHOOTING.md - Common issues and solutions
- API-INFO.md - Complete API reference
- README.md - Project overview

**External Resources:**
- baramundi Security Guide: https://www.baramundi.com/security
- OWASP API Security Top 10: https://owasp.org/www-project-api-security/
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework
- CIS Controls: https://www.cisecurity.org/controls

---

**Document Control:**
- Version: 1.0
- Last Updated: November 4, 2025
- Next Review: February 4, 2026
- Owner: Security Team
- Approver: CISO
