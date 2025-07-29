# Authentication Architecture Issues

## Current State (As of 2025-01-29)

### Problem Summary
The Craftastic Orchestrator has **incomplete authentication architecture**. We have backend APIs that expect authenticated users, but no proper frontend user registration/login system. This has led to several hacky workarounds.

### Backend Authentication Expectations
The backend APIs expect:
- User authentication via JWT tokens (`@fastify/jwt`)
- `request.user.id` to be populated by auth middleware
- User ownership verification for resources (environments, sessions, etc.)

### Frontend Authentication Reality
The frontend currently has:
- **No user registration system**
- **No login/logout UI**
- **No JWT token management**
- **localStorage-based fake user IDs** (`user-${Date.now()}`)

### Hacky Workarounds Implemented

#### 1. Development Mode Bypass
In `src/index.ts`:
```typescript
// Development authentication bypass for testing
if (config.NODE_ENV === 'development') {
  server.addHook('preHandler', async (request, reply) => {
    // Allow test authentication via header in development
    if (request.headers['x-test-user-id']) {
      request.user = { id: request.headers['x-test-user-id'] };
    }
  });
}
```

#### 2. Frontend Header Injection
In `frontend/src/api/client.ts`:
```typescript
// In development, add test user ID header
if (import.meta.env.DEV) {
  const userId = localStorage.getItem('userId') || `user-${Date.now()}`;
  headers['x-test-user-id'] = userId;
}
```

#### 3. User Service ID Resolution
The `userService.resolveUserId()` function tries to handle both UUIDs and legacy string IDs, adding complexity.

### Issues This Creates

1. **Production Broken**: The development bypass won't work in production
2. **No Multi-User Support**: Can't have multiple real users
3. **No Persistent Identity**: User IDs change on browser refresh/clear
4. **Security Gap**: No actual authentication/authorization
5. **GitHub Auth Orphaned**: GitHub tokens are saved but can't be properly associated with persistent users
6. **API Inconsistency**: Some routes expect auth, others don't

### What Should Be Implemented

#### Frontend Needs:
- [ ] User registration page (`/register`)
- [ ] Login page (`/login`) 
- [ ] JWT token storage and management
- [ ] Authenticated route protection
- [ ] User profile/settings page
- [ ] Logout functionality

#### Backend Needs:
- [ ] User registration endpoint (`POST /api/auth/register`)
- [ ] Login endpoint (`POST /api/auth/login`)
- [ ] JWT token validation middleware (remove dev bypass)
- [ ] Password hashing (bcrypt)
- [ ] User management routes

#### Database Needs:
- [ ] Proper `users` table with email/password
- [ ] User session/token management
- [ ] Migration from fake user IDs to real users

### Current User Flow (Broken)
1. User opens app → Gets random `user-${timestamp}` ID
2. Creates environments/sessions → Associated with fake ID  
3. Refreshes browser → Gets NEW fake ID → Loses access to old resources
4. GitHub auth → Tokens saved but orphaned when user ID changes

### Proper User Flow (Target)
1. User visits app → Redirected to login/register
2. User creates account → Real user record in database
3. User logs in → JWT token issued and stored
4. User creates resources → Associated with persistent user ID
5. User can logout/login → Maintains access to their resources
6. GitHub auth → Properly tied to persistent user account

### Temporary vs Permanent Solutions

**Current approach is purely temporary** for development. Before any production deployment, we need:
1. Complete authentication system implementation
2. Migration strategy for any existing fake-user data
3. Removal of all development bypasses
4. Proper security audit

### Files That Need Changes
- `src/index.ts` - Remove dev bypass, add proper auth middleware
- `src/routes/auth.ts` - Add registration/login routes (doesn't exist yet)
- `frontend/src/pages/Login.tsx` - Create login page
- `frontend/src/pages/Register.tsx` - Create registration page  
- `frontend/src/api/client.ts` - Replace fake headers with JWT token management
- Database migrations - Add proper users table with auth fields

---

## GitHub OAuth Configuration

### Shared OAuth App
Craftastic uses a shared GitHub OAuth App for Device Flow authentication:

- **Client ID**: `Ov23liz42T3AzHtmASDC` (safe to commit - public by design)
- **App Name**: Craftastic OAuth App
- **Scopes**: `repo`, `read:user`, `user:email`
- **Device Flow**: Enabled

### Security Notes
- ✅ **Client ID is public** - Safe to commit to git and share
- ❌ **Client Secret** (if any) must be kept private
- 🔒 **Access tokens** are encrypted in database using `ENCRYPTION_KEY`

### Environment Configuration
```bash
# Required in .env
GITHUB_CLIENT_ID=Ov23liz42T3AzHtmASDC
ENCRYPTION_KEY=your-32-byte-hex-key-for-token-encryption

# Optional - defaults to $HOME/.craftastic
CRAFTASTIC_DATA_DIR=$HOME/.craftastic
```

### User Flow
1. User clicks "Connect GitHub" in terminal Git Panel
2. Device Flow generates code (e.g., `1077-B216`)
3. User visits GitHub and enters code
4. App gets access token for git operations (push, pull, commit)
5. Token stored encrypted in database, tied to user session

---

**Priority**: HIGH - This is a fundamental architectural gap that blocks production readiness.