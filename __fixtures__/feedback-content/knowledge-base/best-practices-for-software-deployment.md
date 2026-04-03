# Best Practices for Software Deployment

**URL:** https://feedback.baramundi.com/kb/deployment-best-practices
**Author:** baramundi Product Team
**Published:** 2024-02-28
**Views:** 2,891
**Category:** Best Practices

---

This guide outlines recommended practices for reliable and efficient software deployment using baramundi Management Suite.

## Planning Phase

### 1. Define Deployment Goals
- **Scope**: Which endpoints need the software?
- **Timeline**: Phased rollout or simultaneous?
- **Success Criteria**: How to measure deployment success?

### 2. Test Before Production
Always test deployments in a staging environment:
- Create "Test" logical group with 5-10 representative endpoints
- Test different OS versions and hardware configurations
- Validate success criteria
- Document any issues

### 3. Package Preparation
**Use MSI when possible:**
- MSI packages are more reliable than EXE
- Support silent installation natively
- Built-in rollback capability

**For EXE installers:**
- Research silent installation switches
- Common: `/S`, `/silent`, `/quiet`, `/qn`
- Test with: `setup.exe /? > switches.txt`

## Deployment Strategy

### 1. Phased Rollout
Don't deploy to all endpoints simultaneously:

**Phase 1: Pilot (5%)** - IT department endpoints
- Quick validation
- Identify obvious issues

**Phase 2: Early Adopters (15%)** - Power users, tech-savvy
- Broader testing
- Gather user feedback

**Phase 3: General Rollout (80%)** - All remaining endpoints
- Proven stable
- Confidence in success

### 2. Maintenance Windows
Schedule deployments during off-hours:
- Define maintenance windows per logical group
- Avoid business-critical times (Monday 9 AM, end of quarter)
- Consider time zones for global deployments

### 3. User Communication
Notify users before deployments:
- Email notification 24 hours prior
- Toast notification 30 minutes before
- Clear instructions (restart required? data saved?)

## Job Configuration

### 1. Prerequisites Check
Configure job to verify:
- **Disk space**: Ensure enough free space
- **OS version**: Deploy only to compatible OS
- **Existing installation**: Check if already installed
- **Dependencies**: Ensure prerequisites are met

Example (PowerShell):
```powershell
# Check disk space (10 GB required)
$freeSpace = (Get-PSDrive C).Free / 1GB
if ($freeSpace -lt 10) {
    Write-Error "Insufficient disk space"
    exit 1
}
```

### 2. Error Handling
Configure retry logic:
- **Max retries**: 3 attempts
- **Retry interval**: 1 hour between attempts
- **Failure action**: Email notification to admin
- **Rollback**: Uninstall if deployment fails

### 3. Success Validation
Don't rely solely on exit codes:
- **Registry check**: Verify installation registry key exists
- **File check**: Confirm executable is present
- **Service check**: Ensure service is running (if applicable)
- **Version check**: Validate correct version installed

Example:
```powershell
# Verify Acrobat Reader installation
$version = (Get-ItemProperty "HKLM:\SOFTWARE\Adobe\Acrobat Reader\DC\Installer").Version
if ($version -eq "24.001.20604") {
    Write-Host "Installation successful"
    exit 0
} else {
    Write-Error "Version mismatch"
    exit 1
}
```

## Monitoring & Reporting

### 1. Real-Time Monitoring
Monitor job execution:
- Management Console → Jobs → Job History
- Filter by: In Progress, Failed, Succeeded
- Identify failures quickly

### 2. Scheduled Reports
Create automatic reports:
- Daily: Deployment failures requiring attention
- Weekly: Deployment success rate by logical group
- Monthly: Software inventory compliance

### 3. Alerting
Configure alerts for:
- Job failure rate > 10%
- Critical software deployment failed
- Endpoint offline during scheduled deployment

## Common Pitfalls to Avoid

### ❌ Don't: Deploy without testing
- **Why:** Production failures impact users
- **Do instead:** Always test in staging first

### ❌ Don't: Ignore exit codes
- **Why:** Non-zero exit codes indicate errors
- **Do instead:** Map exit codes to failure actions

### ❌ Don't: Deploy to all endpoints at once
- **Why:** Issues affect entire organization
- **Do instead:** Use phased rollout strategy

### ❌ Don't: Forget about uninstall
- **Why:** May need to rollback quickly
- **Do instead:** Create uninstall job alongside install job

### ❌ Don't: Deploy during business hours
- **Why:** Interrupts user productivity
- **Do instead:** Use maintenance windows

## Tools & Features

### baramundi Automate (bA)
Use Automate for complex deployments:
- Multi-step installations
- Conditional logic
- Variable substitution
- Dynamic endpoint targeting

### Kiosk Job Release
Let users self-install approved software:
- User browses software catalog
- One-click installation
- No admin rights required
- Reduces helpdesk tickets

### Cloud Management Gateway
Deploy to remote/mobile endpoints:
- Internet-based connection
- VPN not required
- Secure encrypted channel
- Works with MDM-enrolled devices

## Checklist: Pre-Deployment

Before executing deployment:
- [ ] Software package tested in staging
- [ ] Silent installation switches validated
- [ ] Prerequisites identified and documented
- [ ] Logical group target defined
- [ ] Maintenance window configured
- [ ] User notification sent
- [ ] Success criteria defined
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured
- [ ] Admin team briefed

## Related Articles

- [Creating Software Jobs](kb/creating-software-jobs)
- [Understanding Exit Codes](kb/exit-codes)
- [Logical Group Best Practices](kb/logical-groups)
- [baramundi Automate Guide](kb/automate-guide)

## Examples

### Example 1: Adobe Acrobat Reader Deployment
```
Job Name: Deploy Adobe Acrobat Reader DC 24.001
Package: AcroRdrDC2400120604_en_US.exe /sAll /rs /msi EULA_ACCEPT=YES
Target: Logical Group "All Windows Workstations"
Schedule: Monday-Friday, 7 PM - 11 PM
Max Runtime: 30 minutes
Retry: 3 times, 1 hour apart
Success: Registry key exists + version matches
```

### Example 2: Microsoft Office 365 Deployment
```
Job Name: Deploy Microsoft 365 Apps (64-bit)
Package: setup.exe /configure configuration.xml
Prerequisites: Windows 10 1903+, 10 GB free space
Target: Logical Group "Office 365 Users"
Schedule: Maintenance Window "Weekend Deployments"
User Notification: 24 hours prior + 1 hour prior
Success: Word.exe version 16.0.17126+
Uninstall: setup.exe /configure uninstall.xml
```

## Support

Questions? Contact:
- **Community Forum**: https://forum.baramundi.com
- **Support Email**: support@baramundi.com
- **Documentation**: https://docs.baramundi.com
