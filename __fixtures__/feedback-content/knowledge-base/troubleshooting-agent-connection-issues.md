# Troubleshooting Agent Connection Issues

**URL:** https://feedback.baramundi.com/kb/agent-connection-troubleshooting
**Author:** baramundi Support Team
**Published:** 2024-01-20
**Views:** 1,245
**Category:** Troubleshooting

---

This article helps diagnose and resolve connectivity issues between baramundi Agents and the Management Server.

## Common Symptoms

- Endpoints not appearing in Management Console
- Jobs not executing on endpoints
- Inventory data not updating
- Agent shows "Disconnected" status

## Diagnostic Steps

### 1. Verify Network Connectivity

**Test:** Can endpoint reach server?
```bash
ping bms-server.company.local
telnet bms-server.company.local 1610
```

**Required Ports:**
- TCP 1610: Agent-to-Server communication
- TCP 444: bConnect REST API (if used)
- TCP 80/443: Web Console (optional)

### 2. Check Agent Service Status

**Windows:**
```powershell
Get-Service "baramundi Agent" | Select-Object Status, StartType
```

**Expected:** Status = Running, StartType = Automatic

**Linux/macOS:**
```bash
systemctl status baramundi-agent
```

### 3. Review Agent Logs

**Windows:** `C:\ProgramData\baramundi\logs\Agent.log`
**Linux:** `/var/log/baramundi/agent.log`
**macOS:** `/Library/Logs/baramundi/agent.log`

**Look for:**
- Connection errors (timeout, refused)
- Authentication failures
- Certificate validation errors

### 4. Verify Server Configuration

**Management Console:**
1. System → Configuration → Server Settings
2. Verify "Agent Communication Port" = 1610
3. Check "Server FQDN" matches DNS name
4. Ensure certificate is valid (not expired)

### 5. Firewall Rules

**Windows Firewall (Endpoint):**
- Allow outbound TCP 1610 to server
- Allow inbound responses

**Corporate Firewall:**
- Verify no proxy/inspection blocking connection
- Check for SSL interception issues

## Common Issues & Solutions

### Issue 1: Certificate Validation Errors
**Symptom:** Agent log shows "SSL certificate validation failed"
**Solution:**
- Ensure server certificate is trusted
- Import CA certificate to endpoint trust store
- Or: Disable certificate validation (development only!)

### Issue 2: Server Not Reachable
**Symptom:** Agent log shows "Connection timeout"
**Solution:**
- Verify DNS resolves server name correctly
- Check routing between endpoint and server
- Confirm firewall allows TCP 1610

### Issue 3: Authentication Failures
**Symptom:** Agent log shows "Authentication denied"
**Solution:**
- Reinstall agent with correct server key
- Verify agent registered in Management Console
- Check agent certificate hasn't expired

## Advanced Troubleshooting

### Enable Debug Logging
1. Edit agent config: `Agent.exe.config` (Windows) or `/etc/baramundi/agent.conf` (Linux)
2. Set `LogLevel=Debug`
3. Restart agent service
4. Reproduce issue
5. Review detailed logs

### Packet Capture
Use Wireshark to capture traffic on TCP 1610:
```
tcp.port == 1610
```

Look for:
- TCP handshake completing (SYN, SYN-ACK, ACK)
- SSL/TLS handshake
- Data transmission

## Related Articles

- [Installing baramundi Agent](kb/agent-installation)
- [Configuring Firewall Rules](kb/firewall-configuration)
- [Agent Certificate Management](kb/agent-certificates)

## Still Need Help?

Contact support with:
- Agent logs (last 1000 lines)
- Network topology diagram
- Firewall rules export
- Server version and endpoint OS

**Support:** support@baramundi.com
