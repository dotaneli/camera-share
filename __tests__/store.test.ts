// Pure logic test — no Expo runtime needed
import { useAppStore } from '../lib/store';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ role: null });
  });

  it('starts with null role', () => {
    expect(useAppStore.getState().role).toBeNull();
  });

  it('sets role to camera', () => {
    useAppStore.getState().setRole('camera');
    expect(useAppStore.getState().role).toBe('camera');
  });

  it('sets role to viewfinder', () => {
    useAppStore.getState().setRole('viewfinder');
    expect(useAppStore.getState().role).toBe('viewfinder');
  });

  it('resets role to null', () => {
    useAppStore.getState().setRole('camera');
    useAppStore.getState().resetRole();
    expect(useAppStore.getState().role).toBeNull();
  });

  it('can switch roles', () => {
    useAppStore.getState().setRole('camera');
    useAppStore.getState().setRole('viewfinder');
    expect(useAppStore.getState().role).toBe('viewfinder');
  });
});
