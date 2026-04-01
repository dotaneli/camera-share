import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../lib/store';
import log from '../lib/logger';

export default function ViewfinderScreen() {
  const router = useRouter();
  const resetRole = useAppStore((s) => s.resetRole);

  const handleBack = () => {
    log.info('Leaving viewfinder mode');
    resetRole();
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.icon}>👁</Text>
        <Text style={styles.title}>Viewfinder Mode</Text>
        <Text style={styles.status}>Ready to scan...</Text>
        <Text style={styles.hint}>Point at the Camera phone's QR code</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  backButton: {
    padding: 8,
  },
  backText: {
    color: '#4aff9e',
    fontSize: 16,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  status: {
    color: '#4aff9e',
    fontSize: 18,
    marginBottom: 8,
  },
  hint: {
    color: '#666',
    fontSize: 14,
  },
});
