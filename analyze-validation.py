#!/usr/bin/env python3
"""Analyze input validation implementation in src/index.ts"""

import re

# Read the index.ts file
with open('src/index.ts', 'r') as f:
    content = f.read()

# Find all case statements
case_pattern = r'case "([^"]+)":'
cases = re.findall(case_pattern, content)

print(f"Total case statements: {len(cases)}")

# Find case statements with validateOrThrow
validated_cases = []
unvalidated_cases = []

# Split content into lines for analysis
lines = content.split('\n')

for i, line in enumerate(lines):
    if 'case "' in line:
        # Extract case name
        match = re.search(r'case "([^"]+)":', line)
        if match:
            case_name = match.group(1)

            # Check next few lines for validateOrThrow
            has_validation = False
            for j in range(i+1, min(i+10, len(lines))):
                if 'validateOrThrow' in lines[j]:
                    has_validation = True
                    break
                # Stop if we hit another case or break
                if 'case "' in lines[j] or 'break;' in lines[j]:
                    break

            if has_validation:
                validated_cases.append(case_name)
            else:
                unvalidated_cases.append(case_name)

print(f"\nValidated cases: {len(validated_cases)}")
print(f"Unvalidated cases: {len(unvalidated_cases)}")
print(f"Progress: {len(validated_cases)}/{len(cases)} ({len(validated_cases)*100//len(cases)}%)")

print("\n" + "="*80)
print("UNVALIDATED CASES:")
print("="*80)
for case in unvalidated_cases:
    print(f"  - {case}")

# Group unvalidated by likely module
print("\n" + "="*80)
print("UNVALIDATED CASES BY CATEGORY:")
print("="*80)

v11_cases = [c for c in unvalidated_cases if '_v1' in c]
security_group_cases = [c for c in unvalidated_cases if 'security_group' in c]
doc_search_cases = [c for c in unvalidated_cases if 'documentation' in c or 'known_issues' in c]
os_cases = [c for c in unvalidated_cases if 'os_' in c and '_v1' not in c]
vpp_cases = [c for c in unvalidated_cases if 'vpp_' in c]
bitlocker_cases = [c for c in unvalidated_cases if 'bitlocker' in c or 'tpm_' in c or 'secrets' in c or 'secret_by' in c]
compliance_cases = [c for c in unvalidated_cases if 'compliance' in c]
inventory_cases = [c for c in unvalidated_cases if 'inventory_' in c]
ssh_cases = [c for c in unvalidated_cases if 'ssh' in c]
setup_integrity_cases = [c for c in unvalidated_cases if 'integrity' in c]
server_mgmt_cases = [c for c in unvalidated_cases if any(x in c for x in ['management_server', 'gateway', 'dip_', 'vpn_', 'microservice', 'cloud_connector', 'pxe_', 'security_profile', 'object_'])]
endpoint_cases = [c for c in unvalidated_cases if 'endpoint' in c and c not in security_group_cases and c not in os_cases and c not in v11_cases]
maintenance_cases = [c for c in unvalidated_cases if 'maintenance_window' in c]
asset_cases = [c for c in unvalidated_cases if 'asset_' in c]

print(f"\nV1.1 APIs (total): {len(v11_cases)}")
for case in v11_cases:
    print(f"  - {case}")

print(f"\nSecurity Groups: {len(security_group_cases)}")
for case in security_group_cases:
    print(f"  - {case}")

print(f"\nDocumentation Search: {len(doc_search_cases)}")
for case in doc_search_cases:
    print(f"  - {case}")

print(f"\nOperating Systems: {len(os_cases)}")
for case in os_cases:
    print(f"  - {case}")

print(f"\nServer Management: {len(server_mgmt_cases)}")
for case in server_mgmt_cases:
    print(f"  - {case}")

print(f"\nEndpoints: {len(endpoint_cases)}")
for case in endpoint_cases:
    print(f"  - {case}")

print(f"\nMaintenance Windows: {len(maintenance_cases)}")
for case in maintenance_cases:
    print(f"  - {case}")

print(f"\nAssets: {len(asset_cases)}")
for case in asset_cases:
    print(f"  - {case}")

# Separate V1.1 by module
print("\n" + "="*80)
print("V1.1 APIs BY MODULE:")
print("="*80)

print(f"\nComplianceViolations V1.1: {len(compliance_cases)}")
for case in compliance_cases:
    print(f"  - {case}")

print(f"\nBitLocker V1.1: {len(bitlocker_cases)}")
for case in bitlocker_cases:
    print(f"  - {case}")

print(f"\nVPP V1.1: {len(vpp_cases)}")
for case in vpp_cases:
    print(f"  - {case}")

print(f"\nInventory V1.1: {len(inventory_cases)}")
for case in inventory_cases:
    print(f"  - {case}")

print(f"\nSSH V1.1: {len(ssh_cases)}")
for case in ssh_cases:
    print(f"  - {case}")

print(f"\nSetup Integrity V1.1: {len(setup_integrity_cases)}")
for case in setup_integrity_cases:
    print(f"  - {case}")

# Summary by plan phases
print("\n" + "="*80)
print("PROGRESS BY IMPLEMENTATION PLAN PHASES:")
print("="*80)

phase1_tools = security_group_cases + doc_search_cases + os_cases
phase2a_tools = compliance_cases
phase2b_tools = bitlocker_cases
phase2c_tools = vpp_cases
phase2d_tools = inventory_cases
phase2e_tools = ssh_cases + setup_integrity_cases

print(f"\nPhase 1 (Security Groups + Doc Search + OS): {len(phase1_tools)}")
print(f"  - Security Groups: {len(security_group_cases)}")
print(f"  - Doc Search: {len(doc_search_cases)}")
print(f"  - OS: {len(os_cases)}")

print(f"\nPhase 2A (ComplianceViolations V1): {len(phase2a_tools)}")
print(f"\nPhase 2B (BitLocker V1): {len(phase2b_tools)}")
print(f"\nPhase 2C (VPP V1): {len(phase2c_tools)}")
print(f"\nPhase 2D (Inventory V1): {len(phase2d_tools)}")
print(f"\nPhase 2E (SSH + Setup Integrity V1): {len(phase2e_tools)}")

total_v11 = len(compliance_cases) + len(bitlocker_cases) + len(vpp_cases) + len(inventory_cases) + len(ssh_cases) + len(setup_integrity_cases)
print(f"\nTotal V1.1 (Phase 2A-E): {total_v11}")
print(f"\nServer Management (Phase 2F-H): {len(server_mgmt_cases)}")

phase3_tools = endpoint_cases + maintenance_cases + asset_cases
print(f"\nPhase 3 (Endpoints + Assets): {len(phase3_tools)}")
print(f"  - Endpoints: {len(endpoint_cases)}")
print(f"  - Maintenance Windows: {len(maintenance_cases)}")
print(f"  - Assets: {len(asset_cases)}")

# Calculate what was done
baseline = 109
total_cases_count = len(cases)
current_validated = len(validated_cases)

print("\n" + "="*80)
print("SUMMARY:")
print("="*80)
print(f"Baseline (plan start): 109/186 (59%)")
print(f"Current state: {current_validated}/{total_cases_count} ({current_validated*100//total_cases_count}%)")
print(f"Progress made: +{current_validated - baseline} tools")
print(f"Remaining: {len(unvalidated_cases)} tools")
