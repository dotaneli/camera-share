import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../lib/store';
import log from '../lib/logger';
import { rlog } from '../lib/remote-logger';
import { getVersionInfo, formatVersionSummary } from '../lib/version-info';

export default function RoleSelectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setRole = useAppStore((s) => s.setRole);
  const versionSummary = formatVersionSummary(getVersionInfo());

  rlog.info('app', 'RoleSelectScreen rendering');

  const handleRole = (role: 'camera' | 'viewfinder') => {
    rlog.info('app', `Role selected: ${role}`);
    setRole(role);
    router.push(`/${role}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CameraShare</Text>
      <Text style={styles.subtitle}>Choose your role</Text>

      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.cameraButton, pressed && styles.pressed]}
          onPress={() => handleRole('camera')}
          accessibilityLabel="I'm the Camera"
          accessibilityRole="button"
        >
          <Text style={styles.buttonEmoji}>📷</Text>
          <Text style={styles.buttonTitle}>I'm the Camera</Text>
          <Text style={styles.buttonDesc}>This phone takes the photos</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, styles.viewfinderButton, pressed && styles.pressed]}
          onPress={() => handleRole('viewfinder')}
          accessibilityLabel="I'm the Viewfinder"
          accessibilityRole="button"
        >
          <Text style={styles.buttonEmoji}>👁</Text>
          <Text style={styles.buttonTitle}>I'm the Viewfinder</Text>
          <Text style={styles.buttonDesc}>This phone controls the shot</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/about')}
        style={[styles.aboutButton, { bottom: insets.bottom + 16 }]}
        accessibilityLabel="About and version info"
        accessibilityRole="button"
      >
        <Text style={styles.aboutText}>About · {versionSummary}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 48,
  },
  buttons: {
    width: '100%',
    gap: 20,
  },
  button: {
    width: '100%',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  cameraButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#4a9eff',
  },
  viewfinderButton: {
    backgroundColor: '#1a2e1a',
    borderWidth: 1,
    borderColor: '#4aff9e',
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  buttonEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  buttonTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  buttonDesc: {
    color: '#999',
    fontSize: 14,
  },
  aboutButton: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  aboutText: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
