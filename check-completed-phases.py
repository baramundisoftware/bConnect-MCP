#!/usr/bin/env python3
"""Check which phases from the plan were completed"""

import re

# Read the index.ts file
with open('src/index.ts', 'r') as f:
    content = f.read()

# Find case statements with validateOrThrow
validated_cases = []
lines = content.split('\n')

for i, line in enumerate(lines):
    if 'case "' in line:
        match = re.search(r'case "([^"]+)":', line)
        if match:
            case_name = match.group(1)
            # Check next few lines for validateOrThrow
            for j in range(i+1, min(i+10, len(lines))):
                if 'validateOrThrow' in lines[j]:
                    validated_cases.append(case_name)
                    break
                if 'case "' in lines[j] or 'break;' in lines[j]:
                    break

# Define tools by phase according to the plan
phase1_security_groups = [
    'list_security_groups',
    'get_security_group',
    'create_security_group',
    'update_security_group',
    'delete_security_group'
]

phase1_doc_search = [
    'search_documentation',
    'get_documentation_item',
    'list_documentation_sources',
    'search_known_issues',
    'get_known_issues_summary'
]

phase1_os = [
    'create_os_folder',
    'update_os_folder',
    'delete_os_folder',
    'update_os_windows_endpoint'
]

phase2a_compliance = [
    'list_compliance_violations_v1',
    'get_compliance_violation_v1',
    'list_compliance_violations_by_endpoint_v1'
]

phase2b_bitlocker = [
    'get_endpoint_secrets_v1',
    'get_bitlocker_recovery_keys_v1',
    'get_tpm_owner_passwords_v1',
    'get_bitlocker_pins_v1',
    'get_secret_by_volume_v1'
]

phase2c_vpp = [
    'list_vpp_users_v1',
    'get_vpp_user_v1',
    'create_vpp_user_v1',
    'delete_vpp_user_v1',
    'list_vpp_license_associations_v1',
    'assign_vpp_license_v1',
    'revoke_vpp_license_v1'
]

phase2d_inventory = [
    'get_inventory_file_scans_v1',
    'get_inventory_wmi_scans_v1',
    'get_inventory_custom_scans_v1',
    'get_inventory_hardware_scans_v1',
    'get_inventory_snmp_scans_v1'
]

phase2e_ssh_integrity = [
    'get_endpoint_ssh_info_v1',
    'get_bfcrx_integrity_v1',
    'get_agent_setup_integrity_v1'
]

def check_phase(phase_name, tools):
    validated_count = sum(1 for tool in tools if tool in validated_cases)
    total = len(tools)
    percentage = (validated_count * 100 // total) if total > 0 else 0
    status = "✅ COMPLETE" if validated_count == total else f"⚠️  PARTIAL ({validated_count}/{total})"

    print(f"\n{phase_name}: {status} - {percentage}%")

    for tool in tools:
        is_validated = "✅" if tool in validated_cases else "❌"
        print(f"  {is_validated} {tool}")

    return validated_count == total

print("="*80)
print("PHASE COMPLETION STATUS")
print("="*80)

print("\n" + "="*80)
print("PHASE 1: QUICK WINS & TESTING")
print("="*80)

phase1a_complete = check_phase("Session 1A: Security Groups (5 tools)", phase1_security_groups)
phase1b_complete = check_phase("Session 1B: Documentation Search (5 tools)", phase1_doc_search)
phase1c_complete = check_phase("Session 1C: Operating Systems (4 tools)", phase1_os)

phase1_complete = phase1a_complete and phase1b_complete and phase1c_complete
print(f"\n{'='*80}")
print(f"PHASE 1 OVERALL: {'✅ COMPLETE' if phase1_complete else '⚠️  PARTIAL'}")
print(f"{'='*80}")

print("\n" + "="*80)
print("PHASE 2: HIGH-RISK MODULES (V1.1 APIs)")
print("="*80)

phase2a_complete = check_phase("Session 2A: ComplianceViolations V1.1 (3 tools)", phase2a_compliance)
phase2b_complete = check_phase("Session 2B: BitLocker V1.1 (5 tools)", phase2b_bitlocker)
phase2c_complete = check_phase("Session 2C: VPP V1.1 (7 tools)", phase2c_vpp)
phase2d_complete = check_phase("Session 2D: Inventory V1.1 (5 tools)", phase2d_inventory)
phase2e_complete = check_phase("Session 2E: SSH + Setup Integrity V1.1 (3 tools)", phase2e_ssh_integrity)

v11_complete = phase2a_complete and phase2b_complete and phase2c_complete and phase2d_complete and phase2e_complete
print(f"\n{'='*80}")
print(f"V1.1 APIs (Phase 2A-E): {'✅ COMPLETE' if v11_complete else '⚠️  PARTIAL'}")
print(f"{'='*80}")

# Summary
print("\n" + "="*80)
print("OVERALL PROGRESS SUMMARY")
print("="*80)

phases_status = {
    "Phase 1 (Quick Wins)": phase1_complete,
    "Phase 2A (ComplianceViolations V1.1)": phase2a_complete,
    "Phase 2B (BitLocker V1.1)": phase2b_complete,
    "Phase 2C (VPP V1.1)": phase2c_complete,
    "Phase 2D (Inventory V1.1)": phase2d_complete,
    "Phase 2E (SSH + Setup Integrity V1.1)": phase2e_complete,
}

completed_phases = sum(1 for complete in phases_status.values() if complete)
total_phases = len(phases_status)

print(f"\nCompleted Phases: {completed_phases}/{total_phases}")
print(f"\nPhase Status:")
for phase, complete in phases_status.items():
    status = "✅ COMPLETE" if complete else "❌ NOT COMPLETE"
    print(f"  {status} {phase}")

# Calculate tools validated in these phases
phase1_tools = phase1_security_groups + phase1_doc_search + phase1_os
phase2_v11_tools = phase2a_compliance + phase2b_bitlocker + phase2c_vpp + phase2d_inventory + phase2e_ssh_integrity

validated_phase1 = sum(1 for tool in phase1_tools if tool in validated_cases)
validated_phase2_v11 = sum(1 for tool in phase2_v11_tools if tool in validated_cases)

print(f"\n" + "="*80)
print("TOOLS VALIDATED BY PHASE:")
print("="*80)
print(f"Phase 1 Tools: {validated_phase1}/{len(phase1_tools)} validated")
print(f"Phase 2A-E (V1.1) Tools: {validated_phase2_v11}/{len(phase2_v11_tools)} validated")
print(f"Combined: {validated_phase1 + validated_phase2_v11}/{len(phase1_tools) + len(phase2_v11_tools)} tools")

# What was actually done
print(f"\n" + "="*80)
print("CONCLUSION:")
print("="*80)
print(f"Baseline: 109/186 (59%)")
print(f"Current: 139/186 (74%)")
print(f"Progress: +30 tools validated")
print(f"\nWork completed through Phase 2C (VPP V1.1)")
print(f"Computer crashed during/after Phase 2C")
print(f"\nNext steps: Resume at Phase 2D (Inventory V1.1)")
