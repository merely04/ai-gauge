import { describe, it, expect, test } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawnSync } from 'bun';
import { tmpdir } from 'os';
import { join } from 'path';

// Test values for substitution
const serverValues = {
  '__BUN_PATH__': '/usr/local/bin/bun',
  '__SERVER_PATH__': '/usr/local/bin/ai-gauge-server',
  '__LOG_DIR__': '/tmp/test-logs',
  '__HOME__': '/tmp/test-home'
};

const menubarValues = {
  '__MENUBAR_BINARY_PATH__': '/usr/local/bin/ai-gauge-menubar',
  '__LOG_DIR__': '/tmp/test-logs',
  '__HOME__': '/tmp/test-home'
};

// Helper to substitute placeholders
function substituteTemplate(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

// Helper to check for remaining placeholders
function hasPlaceholders(content) {
  return /__[A-Z_]+__/.test(content);
}

// Helper to run plutil lint (macOS only)
function lintPlist(filePath) {
  const result = spawnSync(['plutil', '-lint', filePath]);
  return result.exitCode === 0;
}

// Helper to extract plist value
function extractPlistValue(filePath, key) {
  const result = spawnSync(['plutil', '-extract', key, 'raw', filePath]);
  if (result.stdout instanceof Buffer) {
    return result.stdout.toString('utf-8');
  }
  return result.stdout || '';
}

describe('plist-template', () => {
  // Test 1: Server template substitution
  it('should substitute all placeholders in server template', () => {
    const template = readFileSync('lib/ai-gauge-server.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, serverValues);
    
    expect(substituted).toContain('/usr/local/bin/bun');
    expect(substituted).toContain('/usr/local/bin/ai-gauge-server');
    expect(substituted).toContain('/tmp/test-logs');
    expect(substituted).toContain('/tmp/test-home');
    expect(hasPlaceholders(substituted)).toBe(false);
  });

  // Test 2: Menubar template substitution
  it('should substitute all placeholders in menubar template', () => {
    const template = readFileSync('lib/ai-gauge-menubar.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, menubarValues);
    
    expect(substituted).toContain('/usr/local/bin/ai-gauge-menubar');
    expect(substituted).toContain('/tmp/test-logs');
    expect(substituted).toContain('/tmp/test-home');
    expect(hasPlaceholders(substituted)).toBe(false);
  });

  // Test 3: Server plist lint validation (macOS only)
  test.skipIf(process.platform !== 'darwin')('should produce valid plist for server template', () => {
    const template = readFileSync('lib/ai-gauge-server.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, serverValues);
    
    const tmpFile = join(tmpdir(), 'test-server.plist');
    writeFileSync(tmpFile, substituted);
    
    try {
      const isValid = lintPlist(tmpFile);
      expect(isValid).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // Test 4: Menubar plist lint validation (macOS only)
  test.skipIf(process.platform !== 'darwin')('should produce valid plist for menubar template', () => {
    const template = readFileSync('lib/ai-gauge-menubar.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, menubarValues);
    
    const tmpFile = join(tmpdir(), 'test-menubar.plist');
    writeFileSync(tmpFile, substituted);
    
    try {
      const isValid = lintPlist(tmpFile);
      expect(isValid).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // Test 5: Server plist Label extraction (macOS only)
  test.skipIf(process.platform !== 'darwin')('should have correct Label in server plist', () => {
    const template = readFileSync('lib/ai-gauge-server.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, serverValues);
    
    const tmpFile = join(tmpdir(), 'test-server-label.plist');
    writeFileSync(tmpFile, substituted);
    
    try {
      const output = extractPlistValue(tmpFile, 'Label');
      expect(output).toContain('com.ai-gauge.server');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // Test 6: Menubar plist Label extraction (macOS only)
  test.skipIf(process.platform !== 'darwin')('should have correct Label in menubar plist', () => {
    const template = readFileSync('lib/ai-gauge-menubar.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, menubarValues);
    
    const tmpFile = join(tmpdir(), 'test-menubar-label.plist');
    writeFileSync(tmpFile, substituted);
    
    try {
      const output = extractPlistValue(tmpFile, 'Label');
      expect(output).toContain('com.ai-gauge.menubar');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // Test 7: Server plist ProgramArguments (macOS only)
  test.skipIf(process.platform !== 'darwin')('should have correct ProgramArguments in server plist', () => {
    const template = readFileSync('lib/ai-gauge-server.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, serverValues);
    
    const tmpFile = join(tmpdir(), 'test-server-args.plist');
    writeFileSync(tmpFile, substituted);
    
    try {
      // Verify the substituted content contains the expected paths
      expect(substituted).toContain('<string>/usr/local/bin/bun</string>');
      expect(substituted).toContain('<string>/usr/local/bin/ai-gauge-server</string>');
      
      // Also verify plist is valid
      const isValid = lintPlist(tmpFile);
      expect(isValid).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // Test 8: No placeholder remnants in server template
  it('should have no placeholder remnants after server substitution', () => {
    const template = readFileSync('lib/ai-gauge-server.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, serverValues);
    
    const placeholderMatches = substituted.match(/__[A-Z_]+__/g);
    expect(placeholderMatches).toBeNull();
  });

  // Test 9: No placeholder remnants in menubar template
  it('should have no placeholder remnants after menubar substitution', () => {
    const template = readFileSync('lib/ai-gauge-menubar.plist.template', 'utf-8');
    const substituted = substituteTemplate(template, menubarValues);
    
    const placeholderMatches = substituted.match(/__[A-Z_]+__/g);
    expect(placeholderMatches).toBeNull();
  });
});
