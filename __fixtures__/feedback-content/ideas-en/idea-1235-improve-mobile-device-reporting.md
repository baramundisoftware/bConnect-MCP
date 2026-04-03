# Improve Mobile Device Management Reporting

**URL:** https://feedback.baramundi.com/ideas/1235
**Author:** MDMAdmin
**Published:** 2024-04-02
**Votes:** 31
**Status:** Planned
**Category:** Mobile Device Management

---

## Description

The current MDM reporting capabilities are basic. I would like to see **enhanced reporting for iOS and Android devices** with more granular data and customizable reports.

## Current Limitations

1. **Limited Data Points**: Only basic info (OS version, model, enrollment date)
2. **No App Usage**: Can't see which apps are actually being used
3. **Fixed Report Templates**: Can't customize columns or filters
4. **No Export Options**: Can't export to Excel/CSV easily
5. **No Scheduled Reports**: Must run reports manually

## Proposed Enhancements

### 1. Expanded Data Points
- **Battery Health**: Current capacity, cycle count, charging status
- **Storage Usage**: App-specific storage consumption
- **Network Usage**: Data consumption per app (cellular + Wi-Fi)
- **Screen Time**: Daily usage statistics
- **App Usage**: Most used apps, last used timestamp
- **Compliance Status**: Passcode enabled, encryption status, jailbreak detection

### 2. Customizable Report Builder
Allow admins to:
- Select which columns to include
- Apply filters (OS version, enrollment date, compliance status)
- Group by (device type, department, location)
- Sort by any column
- Save report templates

### 3. Scheduled Reports
- **Daily**: Compliance violations report (email to security team)
- **Weekly**: New enrollments summary
- **Monthly**: App usage trends, storage capacity planning
- **Quarterly**: Device lifecycle (devices due for replacement)

### 4. Export Formats
- **Excel (.xlsx)**: With formatting and charts
- **CSV**: For import into other systems
- **PDF**: For management presentations
- **JSON**: For API integration

### 5. Dashboard Visualizations
- **Charts**: Device distribution (iOS vs Android, OS versions)
- **Heatmaps**: Network usage by department
- **Trend Lines**: Enrollment growth over time
- **Alerts**: Non-compliant devices requiring attention

## Use Cases

### Use Case 1: Compliance Audit
**Goal**: Prove to auditors that all mobile devices have encryption enabled

**Report:**
- Filter: All enrolled devices
- Columns: Device Name, Owner, OS Version, Encryption Status, Passcode Enabled
- Export: PDF for audit documentation

### Use Case 2: App License Optimization
**Goal**: Identify unused paid apps to reclaim licenses

**Report:**
- Filter: Apps with "Last Used > 90 days ago"
- Columns: App Name, Owner, Last Used Date, License Cost
- Export: Excel for CFO review

### Use Case 3: Storage Capacity Planning
**Goal**: Predict which devices need storage upgrades

**Report:**
- Filter: Storage Used > 85%
- Columns: Device Name, Total Storage, Used Storage, Largest App
- Schedule: Monthly email to procurement team

## Example Report: Non-Compliant Devices

| Device Name | Owner | OS | Passcode | Encryption | Jailbroken | Action |
|-------------|-------|----|----|------------|----------|--------|
| iPhone-1234 | John Smith | iOS 16.5 | ❌ No | ✅ Yes | ❌ No | Enforce passcode |
| Galaxy-5678 | Jane Doe | Android 13 | ✅ Yes | ❌ No | ❌ No | Enable encryption |
| iPad-9012 | Bob Admin | iOS 15.2 | ✅ Yes | ✅ Yes | ⚠️ Detected | Wipe device |

**Export:** Email to security team daily at 6 AM

## Comparison: Current vs Proposed

| Feature | Current | Proposed |
|---------|---------|----------|
| Data points | 10 basic fields | 50+ detailed fields |
| Customization | Fixed templates | Fully customizable |
| Export | Manual CSV | Excel, PDF, JSON |
| Scheduling | ❌ No | ✅ Daily, weekly, monthly |
| Visualizations | ❌ No | ✅ Charts and dashboards |

## Community Feedback

**SupportedBy:**
- MobileAdmin: "We desperately need better MDM reporting!"
- SecurityOfficer: "+1, compliance reporting is critical"
- ITDirector: "This would save us 5 hours/week on manual reports"

**Votes:** 31 (and counting!)

## Implementation Priority

**High Priority:**
1. ✅ Planned for 2025 R1 release
2. Currently in design phase
3. Beta testing planned for Q4 2024

## Related Ideas

- #1145: Add MDM Dashboard widgets
- #1198: Export device inventory to CMDB
- #1220: API endpoint for MDM reporting data
