// mobile/app/(tabs)/profile.js
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, Alert, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

const THEME_GREEN = '#166534';

export default function ProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState({ full_name: '', email: '', profile_photo_url: '' });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) {
        if (mounted) setLoading(false);
        return;
      }
      const user = authData.user;
      if (mounted) setAuthUser(user);

      let { data, error } = await supabase
        .from('users')
        .select('full_name,email,profile_photo_url')
        .eq('user_id', user.id)
        .single();

      if (error || !data) {
        const fb = await supabase
          .from('users')
          .select('full_name,email,profile_photo_url')
          .eq('id', user.id)
          .single();
        if (!fb.error && fb.data) data = fb.data;
      }

      if (mounted && data) setProfile(data);
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    } else {
      router.replace('/'); // go back to entry
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        {profile?.profile_photo_url ? (
          <Image source={{ uri: profile.profile_photo_url }} style={{ width: 96, height: 96, borderRadius: 48 }} />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#d1d5db' }} />
        )}
      </View>

      <Text style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }}>
        {profile?.full_name || authUser?.email || 'Profile'}
      </Text>
      <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginTop: 4 }}>
        {profile?.email || authUser?.email}
      </Text>

      <View style={{ height: 24 }} />

      <Pressable
        onPress={signOut}
        style={{
          backgroundColor: THEME_GREEN,
          paddingVertical: 12,
          borderRadius: 8,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}
