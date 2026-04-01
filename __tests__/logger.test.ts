// Mock __DEV__ for logger test
(globalThis as any).__DEV__ = true;

import log from '../lib/logger';

describe('Logger', () => {
  it('exists and has log methods', () => {
    expect(log).toBeDefined();
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('does not throw when logging', () => {
    expect(() => log.info('test message')).not.toThrow();
    expect(() => log.debug('debug message')).not.toThrow();
    expect(() => log.warn('warn message')).not.toThrow();
    expect(() => log.error('error message')).not.toThrow();
  });
});
