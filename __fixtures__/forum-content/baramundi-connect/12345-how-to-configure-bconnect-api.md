# How to configure bConnect API?

**URL:** https://forum.baramundi.com/index.php?threads/12345/
**Author:** TestUser1
**Date:** 2024-01-15
**Replies:** 5
**Status:** ✅ SOLVED

## Original Post

I need help configuring the bConnect REST API on my baramundi Management Server.

I've installed the server but can't access the API endpoints. When I navigate to https://server:444/bconnect/endpoints/v2.0/WindowsEndpoints, I get a 401 Unauthorized error.

What are the correct authentication steps?

## Replies

### Reply 1 - baramundi Support
**Date:** 2024-01-15

To configure bConnect API authentication:

1. Open baramundi Management Console
2. Navigate to Configuration → Security → API Users
3. Create a new API user with appropriate permissions
4. Use HTTP Basic Auth with username and password

Example using curl:
```bash
curl -u "username:password" https://server:444/bconnect/endpoints/v2.0/WindowsEndpoints
```

### Reply 2 - TestUser1
**Date:** 2024-01-16

Thank you! That worked perfectly. I created an API user and now I can access all endpoints.

Marking this as solved.
