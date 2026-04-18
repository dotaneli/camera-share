import { useMemo } from 'react';
import { ScrollView, Share, StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getVersionInfo, formatVersionSummary } from '../lib/version-info';

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const info = useMemo(() => getVersionInfo(), []);

  const rows: Array<[string, string]> = [
    ['App version', info.appVersion],
    ['Runtime version', info.runtimeVersion],
    ['Platform', info.platform],
    [info.platform === 'ios' ? 'iOS build #' : 'Android versionCode', info.buildNumber],
    ['Update channel', info.channel],
    ['Update ID', info.updateId ? info.updateId.slice(0, 12) + '…' : '— (embedded)'],
    ['Published at', info.updateCreatedAt ?? '— (embedded)'],
    ['Bundle source', info.isEmbedded ? 'embedded in native build' : 'OTA update'],
  ];
  if (info.isEmergency) rows.push(['Emergency launch', 'yes — OTA failed, fell back to embedded']);

  // Why: expo-clipboard has a native bridge which would break OTA-only delivery.
  // RN's built-in Share API lets the user send the text anywhere (Notes, email, etc.).
  const handleShare = async () => {
    const body = [formatVersionSummary(info), '', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n');
    try {
      await Share.share({ message: body });
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back" accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>About</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.summary}>{formatVersionSummary(info)}</Text>

        <View style={styles.card}>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.key}>{k}</Text>
              <Text style={styles.value} numberOfLines={2}>{v}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={handleShare} style={styles.copyButton} accessibilityLabel="Share version info" accessibilityRole="button">
          <Text style={styles.copyText}>Share version info</Text>
        </Pressable>

        <Text style={styles.hint}>
          When you publish an OTA update, reopen the app twice — the first launch downloads, the
          second applies. Come back here to confirm the Update ID changed.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    minWidth: 60,
  },
  backText: { color: '#4aff9e', fontSize: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600', flex: 1, textAlign: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  summary: {
    color: '#4aff9e',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 20,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
    gap: 12,
  },
  key: { color: '#888', fontSize: 14, flexShrink: 0 },
  value: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right',
  },
  copyButton: {
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4aff9e',
    marginBottom: 24,
  },
  copyText: { color: '#4aff9e', fontSize: 15, fontWeight: '600' },
  hint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});
