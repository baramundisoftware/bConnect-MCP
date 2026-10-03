# Audit logging

Every server can record the requests it sends to bConnect. Set `BCONNECT_AUDIT_LEVEL` in the
server's environment (in the gateway, in `.env.gateway`).

## Levels

Levels are cumulative: each one records everything the level before it records.

| Level | Records |
|---|---|
| `none` (default) | nothing |
| `security` | every call to a security-relevant route (list below), and every request the client refuses before sending it (a credential route while `ALLOW_SECRET_READ` is off, or a path that isn't in canonical form) |
| `write` | the above, plus every write (POST, PATCH, PUT, DELETE) |
| `all` | every request |

The value is read in any case (`Security` works). Any other value stops the server, so a typo
can't switch auditing off; in the gateway, every tool call reports it instead.

## Output

Each entry is one line on **stderr**, never stdout, so auditing works with stdio clients (Claude
Desktop, Claude Code). Security entries start with `[SECURITY AUDIT]`, others with `[AUDIT]`.
A recorded call writes two entries: the request, then its response (with the status) or its
error (with the error message). The response or error entry carries the duration, unless it
rounds to 0 ms. A read retried under `BCONNECT_MAX_RETRIES` writes a request entry for each
attempt, and one response or error entry for the final outcome. A request the client
refuses before sending it writes one entry ending in `- REFUSED: <reason>`. Every entry has a
timestamp, the user (the configured username, or `api-key-user` with an API key), the method and
the path.
Control characters in a path are escaped, so one entry can't forge another. Request parameters and
bodies aren't recorded (no setting turns that on), so neither are credentials.

## Security-relevant routes

Derived from the bConnect API specifications:
- every operation tagged ApiKeys, LocalAdministrativeAccounts, Objects, SecurityGroups or
  SecurityProfiles (credentials, rights, access control);
- every write tagged ManagementServer, Microservices, VariableDefinitions or VariableInstances
  (server availability; a variable can hold a password);
- every operation whose answer or request body carries a credential.

A test checks this list against both specifications (25R2 and 26R1), and requires every other tag
to be classified as not security-relevant with a reason, so a new operation or tag can't be missed.

<!-- security-routes:start -->
| Method | Route | What it is |
|---|---|---|
| `GET` | `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets` | BitLocker recovery keys and startup PIN (26R1) |
| `PATCH` | `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets` | change the BitLocker startup PIN (26R1) |
| `GET` | `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}` | LAPS: local administrator credentials |
| `PATCH` | `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}` | LAPS: change the credentials' expiration |
| `POST` | `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient` | LAPS: ask the client to update its account |
| `POST` | `/endpoints/v2.0/AndroidEndpoints/{id}/StartEnrollment` | start an enrollment (answer carries an enrollment token) |
| `POST` | `/endpoints/v2.0/IosEndpoints/{id}/StartEnrollment` | start an enrollment (answer carries an enrollment token) |
| `POST` | `/endpoints/v2.0/MacEndpoints/{id}/StartEnrollment` | start an enrollment (answer carries an enrollment token) |
| `POST` | `/endpoints/v2.0/WindowsEndpoints/{id}/StartEnrollment` | start an enrollment (answer carries the install command with the enrollment credential) |
| `POST` | `/endpoints/v2.0/LinuxEndpoints` | create a Linux endpoint (body carries a password) |
| `POST` | `/endpoints/v2.0/NetworkEndpoints` | create a network endpoint (body carries SNMP passwords) |
| `POST` | `/endpoints/v2.0/IndustrialEndpoints` | create an industrial endpoint (body carries passwords; 25R2) |
| `GET` | `/servermanagement/v2.0/ApiKeys` | list API keys (26R1) |
| `PATCH` | `/servermanagement/v2.0/Objects/{id}` | change an object's rights |
| `GET` | `/servermanagement/v2.0/Objects/{id}/Rights` | read an object's rights |
| `GET` | `/servermanagement/v2.0/SecurityGroups` | list security groups |
| `POST` | `/servermanagement/v2.0/SecurityGroups` | create a security group |
| `GET` | `/servermanagement/v2.0/SecurityGroups/{id}` | read a security group |
| `PATCH` | `/servermanagement/v2.0/SecurityGroups/{id}` | change a security group |
| `DELETE` | `/servermanagement/v2.0/SecurityGroups/{id}` | delete a security group |
| `GET` | `/servermanagement/v2.0/SecurityProfiles` | list security profiles |
| `POST` | `/servermanagement/v2.0/SecurityProfiles` | create a security profile |
| `GET` | `/servermanagement/v2.0/SecurityProfiles/{id}` | read a security profile |
| `PATCH` | `/servermanagement/v2.0/SecurityProfiles/{id}` | change a security profile |
| `DELETE` | `/servermanagement/v2.0/SecurityProfiles/{id}` | delete a security profile |
| `POST` | `/servermanagement/v2.0/Restart` | restart the management server |
| `POST` | `/servermanagement/v2.0/CancelScheduledRestart` | cancel a scheduled restart |
| `POST` | `/servermanagement/v2.0/Microservices/{id}/Start` | start a microservice |
| `POST` | `/servermanagement/v2.0/Microservices/{id}/Stop` | stop a microservice |
| `POST` | `/servermanagement/v2.0/Microservices/{id}/Restart` | restart a microservice |
| `POST` | `/variables/v2.0/VariableDefinitions` | create a variable definition |
| `PATCH` | `/variables/v2.0/VariableDefinitions/{id}` | change a variable definition |
| `DELETE` | `/variables/v2.0/VariableDefinitions/{id}` | delete a variable definition |
| `PATCH` | `/variables/v2.0/VariableInstances/{id}` | set a variable's value (can be a password) |
<!-- security-routes:end -->
