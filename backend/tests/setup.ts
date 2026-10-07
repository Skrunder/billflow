import os from 'node:os';
import path from 'node:path';

// Must run before any module imports src/config/env.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123456';
process.env.SCHEDULER_ENABLED = 'false';
process.env.DATA_DIR ??= path.join(os.tmpdir(), 'skr-bill-calendar-test');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://unused:unused@localhost:1/unused';
process.env.APP_URL ??= 'http://localhost:8080';
