# Craftastic Orchestrator Test Suite

This directory contains comprehensive tests for the Craftastic Orchestrator service, focusing on Git functionality and API endpoints.

## Test Structure

```
tests/
├── api/                    # API integration tests
│   ├── git.test.ts        # Git API endpoint tests
│   └── health.test.ts     # Basic API health tests
├── services/              # Service unit tests
│   ├── github-auth.test.ts  # GitHub authentication service tests
│   └── worktree.test.ts   # Git worktree service tests
├── helpers/               # Test utilities
│   └── api-client.ts      # Test client and server setup
├── setup.ts              # Global test setup
└── README.md             # This file
```

## Running Tests

### Basic Commands

```bash
# Run all tests once
npm test

# Run tests in watch mode (during development)
npm run test:watch 

# Run tests with coverage report
npm run test:coverage

# Run tests with UI (browser-based test runner)
npm run test:ui
```

### Environment Setup

The tests require:

1. **Database**: PostgreSQL database (same as development)
2. **Docker**: Docker daemon running for container tests
3. **Environment Variables**: Same as development environment

### Test Database

The tests use the same database as development. In a production CI/CD setup, you should:

1. Use a separate test database
2. Run migrations before tests
3. Clean up test data after tests

## Test Categories

### API Integration Tests (`api/`)

These tests verify that the API endpoints work correctly:

- **Authentication**: GitHub device flow, token management
- **Authorization**: User ownership verification, session access control
- **Git Operations**: Status, diff, log, commit, push operations
- **Error Handling**: Invalid inputs, missing resources, unauthorized access

### Service Unit Tests (`services/`)

These tests verify individual service functionality:

- **WorktreeService**: Git repository and worktree management
- **GitHubAuthService**: GitHub authentication and token encryption

### Test Utilities (`helpers/`)

- **ApiTestClient**: Simplified API testing with authentication
- **Test Server Setup**: Isolated Fastify server for testing
- **Data Management**: Test environment and session creation/cleanup

## Key Features

### 🔐 Authentication Testing

Tests use a development authentication bypass via `x-test-user-id` header:

```typescript
const client = new ApiTestClient(server, 'test-user-id');
const response = await client.request('GET', '/api/git/status/session-id');
```

### 🏗️ Test Data Management

Automatic test environment and session setup:

```typescript
const client = new ApiTestClient(server);
const { environmentId, sessionId } = await client.setupTestData();
```

### 🧹 Cleanup

Tests clean up Docker containers and database records to prevent resource leaks.

### ⚡ Fast Execution

Tests use an in-memory Fastify server without external dependencies for fast execution.

## Current Test Status

### ✅ Working Tests

- API endpoint connectivity and responses
- Authentication and authorization flows
- Error handling and validation
- User ID resolution (legacy format support)
- Service instantiation and method availability

### 🔄 Limited by Current Implementation

Some tests expect certain behaviors that match the current state:

- **Sessions without worktrees**: Tests expect 400 errors for git operations on sessions without worktrees
- **Repository not cloned**: Tests expect 404 for repository info on new environments
- **GitHub API calls**: Limited by network access and API rate limits

### 🚧 Future Enhancements

When the following features are implemented, tests should be updated:

1. **Automatic worktree creation**: Update tests to expect successful git operations
2. **Repository cloning**: Update tests to expect repository info availability
3. **Background git operations**: Add tests for async repository setup

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: craftastic_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
        
      - name: Run migrations
        run: npm run migrate
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/craftastic_test
          
      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/craftastic_test
          JWT_SECRET: test-jwt-secret
          NODE_ENV: test
```

## Development Workflow

1. **Write failing test** for new feature
2. **Implement feature** to make test pass
3. **Run full test suite** to ensure no regressions
4. **Add integration tests** for API endpoints
5. **Update documentation** as needed

## Debugging Tests

### Verbose Output

```bash
# Run tests with verbose output
npx vitest run --reporter=verbose

# Run specific test file
npx vitest run tests/api/git.test.ts

# Run tests matching pattern
npx vitest run --grep "GitHub"
```

### Test Debugging

```typescript
// Add debugging to tests
it('should handle git status', async () => {
  console.log('Testing with session:', testData.sessionId);
  const response = await client.request('GET', `/api/git/status/${testData.sessionId}`);
  console.log('Response:', response.body);
  expect(response.status).toBe(400);
});
```

## Contributing

When adding new features:

1. Add corresponding tests in the appropriate directory
2. Update existing tests if behavior changes
3. Ensure all tests pass before submitting PR
4. Add test documentation for complex scenarios

The test suite is designed to grow with the application and provide confidence in the Git integration functionality.