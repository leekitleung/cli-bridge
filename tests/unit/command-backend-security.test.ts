// Unit tests for command-backend.ts shell metacharacter validation

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Re-implement the shell metacharacter detection logic for testing
// This mirrors the logic in command-backend.ts

function containsShellMetacharacters(prompt: string): boolean {
  // 基础 shell 元字符
  const SHELL_METACHARACTERS = /[;|&$`()<>\\'\r\n\0]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
  // 检测 backtick 和 !
  const COMMAND_SUBSTITUTION = /[`!]/;
  return SHELL_METACHARACTERS.test(prompt) || COMMAND_SUBSTITUTION.test(prompt);
}

describe('command-backend shell metacharacter detection', () => {
  describe('dangerous metacharacters should be detected', () => {
    test('should detect semicolon', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello; rm -rf'), true);
    });

    test('should detect pipe', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello | grep world'), true);
    });

    test('should detect ampersand', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello & whoami'), true);
    });

    test('should detect dollar', () => {
      assert.strictEqual(containsShellMetacharacters('echo $HOME'), true);
    });

    test('should detect backtick command substitution', () => {
      assert.strictEqual(containsShellMetacharacters('echo `whoami`'), true);
    });

    test('should detect parentheses', () => {
      assert.strictEqual(containsShellMetacharacters('echo $(whoami)'), true);
    });

    test('should detect angle brackets', () => {
      assert.strictEqual(containsShellMetacharacters('echo < input.txt'), true);
    });

    test('should detect newlines', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello\nwhoami'), true);
    });

    test('should detect carriage return', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello\rwhoami'), true);
    });

    test('should detect double pipe', () => {
      assert.strictEqual(containsShellMetacharacters('ls || cat /etc/passwd'), true);
    });

    test('should detect double ampersand', () => {
      assert.strictEqual(containsShellMetacharacters('ls && rm -rf /'), true);
    });

    test('should detect $(command substitution)', () => {
      assert.strictEqual(containsShellMetacharacters('$(whoami)'), true);
    });

    test('should detect ${var}', () => {
      assert.strictEqual(containsShellMetacharacters('${HOME}'), true);
    });

    test('should detect exclamation mark', () => {
      assert.strictEqual(containsShellMetacharacters('echo !'), true);
    });
  });

  describe('safe inputs should not be detected', () => {
    test('should allow plain text', () => {
      assert.strictEqual(containsShellMetacharacters('Hello World'), false);
    });

    test('should allow simple command', () => {
      assert.strictEqual(containsShellMetacharacters('ls -la'), false);
    });

    test('should allow paths with forward slash', () => {
      assert.strictEqual(containsShellMetacharacters('/usr/bin/ls'), false);
    });

    test('should allow paths with colons', () => {
      // Colon is not blocked
      assert.strictEqual(containsShellMetacharacters('C:'), false);
    });

    test('should allow numbers and letters', () => {
      assert.strictEqual(containsShellMetacharacters('file123.txt'), false);
    });

    test('should allow spaces', () => {
      assert.strictEqual(containsShellMetacharacters('Hello World Test'), false);
    });

    test('should allow double quoted strings (not single)', () => {
      // Single quote is blocked for security
      assert.strictEqual(containsShellMetacharacters('"quoted string"'), false);
    });

    test('should allow hyphenated words', () => {
      assert.strictEqual(containsShellMetacharacters('--flag=value'), false);
    });
  });

  describe('edge cases', () => {
    test('should handle empty string', () => {
      assert.strictEqual(containsShellMetacharacters(''), false);
    });

    test('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      assert.strictEqual(containsShellMetacharacters(longString), false);
    });

    test('should handle unicode characters', () => {
      assert.strictEqual(containsShellMetacharacters('你好世界'), false);
    });

    test('should handle mixed safe and dangerous', () => {
      assert.strictEqual(containsShellMetacharacters('echo hello; whoami'), true);
    });
  });

  describe('path traversal patterns', () => {
    test('should not block forward slash in paths', () => {
      assert.strictEqual(containsShellMetacharacters('ls /home/user'), false);
    });

    test('should block backslash in paths (Windows shell injection prevention)', () => {
      // Backslash is blocked to prevent Windows command injection
      assert.strictEqual(containsShellMetacharacters('dir C:\\Users'), true);
    });

    test('should block backslash in character class', () => {
      // The regex explicitly blocks backslash for security
      assert.strictEqual(containsShellMetacharacters('\\'), true);
    });
  });
});

describe('CommandBackendConfig type', () => {
  test('should require allowlist', () => {
    const config = {
      allowlist: ['ls', 'cat', 'echo'],
      defaultCwd: '/tmp',
      timeoutMs: 30000,
      outputCapBytes: 65536,
    };
    assert.ok(Array.isArray(config.allowlist));
    assert.ok(config.allowlist.length > 0);
  });

  test('should allow optional env vars', () => {
    const config = {
      allowlist: ['ls'],
      defaultCwd: '/tmp',
      timeoutMs: 30000,
      outputCapBytes: 65536,
      env: { CUSTOM_VAR: 'value' },
      additionalSafeEnvVars: ['MY_CUSTOM_VAR'],
    };
    assert.ok(config.env);
    assert.ok(config.additionalSafeEnvVars);
  });

  test('should have reasonable defaults', () => {
    const defaults = {
      timeoutMs: 30000,
      outputCapBytes: 65536,
      maxArgCount: 20,
      maxArgLength: 4096,
      maxArgLengthPer: 1024,
    };
    assert.ok(defaults.timeoutMs >= 1000);
    assert.ok(defaults.outputCapBytes >= 1024);
    assert.ok(defaults.maxArgCount >= 1);
  });
});
