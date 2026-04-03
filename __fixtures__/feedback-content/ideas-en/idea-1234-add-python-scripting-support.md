# Add Python scripting support to baramundi Automate

**URL:** https://feedback.baramundi.com/ideas/1234
**Author:** PowerUser123
**Published:** 2024-03-15
**Votes:** 47
**Status:** Under Review
**Category:** baramundi Automate

---

## Description

Currently, baramundi Automate (bA) only supports VBScript and PowerShell for custom scripting. I would like to see **Python 3.x support** added as a third scripting option.

## Why This is Valuable

1. **Modern Language**: Python is the most popular programming language (TIOBE Index 2024)
2. **Cross-Platform**: Same Python script works on Windows, Linux, and macOS
3. **Rich Ecosystem**: Access to thousands of libraries via pip
4. **IT Automation**: Python is widely used for DevOps and automation
5. **Easier to Learn**: More readable than VBScript, less verbose than PowerShell

## Use Cases

### Example 1: Advanced API Integration
```python
import requests
import json

# Query bConnect API and process results
response = requests.get(
    'https://bms-server/bconnect/endpoints/v2.0/WindowsEndpoints',
    auth=('user', 'password')
)

endpoints = response.json()
for endpoint in endpoints:
    if endpoint['OS'] == 'Windows 11':
        print(f"Windows 11 endpoint: {endpoint['DisplayName']}")
```

### Example 2: Data Processing
```python
import pandas as pd

# Analyze software inventory data
inventory = pd.read_csv('software_inventory.csv')
unlicensed = inventory[inventory['Licensed'] == False]
print(f"Found {len(unlicensed)} unlicensed installations")
```

### Example 3: Network Automation
```python
import paramiko

# SSH to Linux endpoints and run commands
ssh = paramiko.SSHClient()
ssh.connect('linux-endpoint.local', username='admin', password='pass')
stdin, stdout, stderr = ssh.exec_command('df -h')
print(stdout.read().decode())
```

## Implementation Suggestion

1. **Embedded Python Interpreter**: Bundle Python 3.11+ with bA
2. **Library Management**: Include common libraries (requests, paramiko, pandas)
3. **bA API Bindings**: Provide Python module for accessing bA functions
4. **Script Editor**: Syntax highlighting and IntelliSense for Python

## Comparison: VBScript vs PowerShell vs Python

| Feature | VBScript | PowerShell | Python |
|---------|----------|------------|--------|
| Cross-platform | ❌ Windows only | ⚠️ Limited | ✅ Full |
| Modern syntax | ❌ Old | ✅ Good | ✅ Excellent |
| Library ecosystem | ❌ Limited | ✅ Good | ✅ Extensive |
| Learning curve | ⚠️ Medium | ⚠️ Medium | ✅ Easy |
| Community support | ❌ Declining | ✅ Strong | ✅ Strongest |

## Community Feedback

**SupportedBy:**
- AdminJohn: "We already use Python for automation, this would be great!"
- ITManager: "+1, Python would make complex automation much easier"
- DevOpsUser: "Python + bA would be a game-changer for our workflows"

## Related Ideas

- #1189: Add JavaScript support to bA
- #1203: Improve PowerShell error handling
- #1256: Cross-platform script compatibility
