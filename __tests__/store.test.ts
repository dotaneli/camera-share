// Pure logic test — no Expo runtime needed
import { useAppStore } from '../lib/store';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ role: null });
  });

  it('starts with null role', () => {
    expect(useAppStore.getState().role).toBeNull();
  });

  it('sets role to main', () => {
    useAppStore.getState().setRole('main');
    expect(useAppStore.getState().role).toBe('main');
  });

  it('sets role to assistant', () => {
    useAppStore.getState().setRole('assistant');
    expect(useAppStore.getState().role).toBe('assistant');
  });

  it('resets role to null', () => {
    useAppStore.getState().setRole('main');
    useAppStore.getState().resetRole();
    expect(useAppStore.getState().role).toBeNull();
  });

  it('can switch roles', () => {
    useAppStore.getState().setRole('main');
    useAppStore.getState().setRole('assistant');
    expect(useAppStore.getState().role).toBe('assistant');
  });
});
