# Deployment job fails with error code 5

**URL:** https://forum.baramundi.com/index.php?threads/12346/
**Author:** AdminUser
**Date:** 2024-02-10
**Replies:** 12
**Status:** ⏳ UNSOLVED

## Original Post

We're experiencing an issue with software deployment jobs failing consistently with error code 5. This happens on about 30% of our Windows 10 endpoints.

**Environment:**
- baramundi Management Suite 2024 R1
- Windows 10 22H2 endpoints
- Network: Corporate LAN with GPO

**Error message:**
```
Job execution failed: Error code 5 (Access Denied)
Network path: \\bms-server\depot\software\
```

The same software package deploys successfully to other endpoints. Has anyone encountered this?

## Replies

### Reply 1 - TechSupportUser
**Date:** 2024-02-10

Error code 5 typically indicates permission issues. Check:
1. Endpoint computer account has read access to depot share
2. baramundi Agent service is running under correct credentials
3. Network firewall rules allow SMB access

### Reply 2 - AdminUser
**Date:** 2024-02-11

Checked all permissions - they look correct. Still investigating...

### Reply 3 - ExpertUser
**Date:** 2024-02-12

We had similar issues. Try:
- Restart baramundi Agent service on affected endpoints
- Verify depot share path is accessible from endpoint
- Check Windows Event Viewer for additional clues

Still working on root cause analysis.
