import { describe, expect, it } from 'vitest';
import { allowlistEntryError, parseAllowlistEntry } from './policy';

describe('allowlist entry validation in a real browser engine', () => {
  it('accepts exactly the hostname grammar, independent of how the engine URL parser encodes input', () => {
    expect(parseAllowlistEntry('Docs.Example.com:8080/path')).toBe('docs.example.com');
    expect(parseAllowlistEntry('bücher.example')).toBe('xn--bcher-kva.example');
    expect(parseAllowlistEntry('http://[::1]:8080')).toBe('[::1]');
    expect(parseAllowlistEntry('127.0.0.1')).toBe('127.0.0.1');
    expect(parseAllowlistEntry('http://localhost:5173')).toBe('localhost');
    for (const entry of ['*.example.com', 'exa mple.com', 'not a host!!', 'under_score.example', 'xn--', 'a"b.example', 'a<b>.example']) {
      expect(parseAllowlistEntry(entry), entry).toBeUndefined();
      expect(allowlistEntryError(entry), entry).toBe(`"${entry}" is not a valid site. Use a hostname like docs.example.com or a URL.`);
    }
  });
});
