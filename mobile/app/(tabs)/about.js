// mobile/app/(tabs)/about.js
import React from 'react';
import { ScrollView, View, Text, Linking } from 'react-native';

export default function AboutPage() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', marginBottom: 8 }}>
        FootyTrail
      </Text>
      <Text style={{ fontSize: 16, marginBottom: 16 }}>
        Track your football knowledge, play the Daily challenge, and battle in
        Elimination tournaments with friends.
      </Text>

      <View style={{ marginTop: 8, marginBottom: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 6 }}>
          Contact
        </Text>
        <Text
          style={{ fontSize: 16, color: '#2563eb' }}
          onPress={() => Linking.openURL('mailto:footy.trail.app@gmail.com')}
        >
          footy.trail.app@gmail.com
        </Text>
        <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
          Bug reports • Feature requests • New leagues
        </Text>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 6 }}>
          Legal
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: '#333' }}>
          FootyTrail is an independent fan project and is not affiliated with
          any league, club, or data provider. All club and league names are used
          for identification purposes only. By using this app you agree that
          FootyTrail is provided “as is” without warranties of any kind and that
          you are responsible for complying with your local laws and the terms
          of the platforms you connect (e.g., Supabase).
        </Text>
      </View>
    </ScrollView>
  );
}
