import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Logo from '../assets/images/footytrail_logo.png';

export default function PostgamePlaceholder() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const didWin = String(params?.didWin ?? '0') === '1';
  const points = Number(params?.pointsEarned ?? 0);
  const outro = params?.outroLine ? String(params.outroLine) : null;

  // read context to pick title like the live page
  const isDaily = String(params?.isDaily ?? '0') === '1';
  const elimination = (() => { try { return params?.elimination ? JSON.parse(String(params.elimination)) : null; } catch { return null; }})();
  const headerTitle = elimination ? 'Elimination' : (isDaily ? 'Daily Challenge' : 'Regular Daily');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f6f7fb' }} contentContainerStyle={{ padding: 16 }}>
      {/* Header bar below status bar */}
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <Image source={Logo} style={styles.headerLogo} />
          </View>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <View style={styles.headerSide} />
        </View>
      </SafeAreaView>

      <View style={styles.card}>
        <Text style={styles.title}>{didWin ? 'You Won!' : 'Round Over'}</Text>
        <Text style={styles.subtitle}>
          {didWin ? `Points earned: ${points}` : `Better luck next time.`}
        </Text>
        {outro ? <Text style={styles.outro}>{outro}</Text> : null}

        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/game')}
          style={styles.btn}
          activeOpacity={0.85}
        >
          <Text style={styles.btnTxt}>Back to Game</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: 'white' },
  header: {
    height: 56,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  headerSide: { width: 56, alignItems: 'flex-start', justifyContent: 'center' },
  headerLogo: { width: 28, height: 28, borderRadius: 6, resizeMode: 'contain' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#111827' },

  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    borderColor: '#eef1f6',
    borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#374151', textAlign: 'center', marginBottom: 12 },
  outro: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 16 },
  btn: {
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnTxt: { color: 'white', fontWeight: '700', fontSize: 16 },
});
