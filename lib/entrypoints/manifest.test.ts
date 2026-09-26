import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';
import type { UserManifest } from 'wxt';

describe('manifest permissions', () => {
  it('requests only storage and activeTab', () => {
    expect((config.manifest as UserManifest).permissions).toEqual(['storage', 'activeTab']);
  });
});
