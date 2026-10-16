import React, { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../utils/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import AuthLayout from '../components/premium/AuthLayout';
import AuthInput from '../components/premium/AuthInput';
import GlowButton from '../components/premium/GlowButton';

export default function PremiumLoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useFocusEffect(
    useCallback(() => {
      setEmail('');
      setPassword('');
    }, [])
  );

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Email and password are required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Invalid Format', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          Alert.alert(
            'Activation Required',
            'Your Guardian account is created but not yet active. Check your inbox (and spam) to confirm registration.',
            [{ text: 'GOT IT' }]
          );
          return;
        }
        throw error;
      }

      if (data.session) {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      Alert.alert('Access Denied', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Secure Access"
      subtitle="Authentication required for Guardian services"
      footerText="NEW GUARDIAN?"
      footerLink="RECRUIT NOW"
      onFooterPress={() => router.push('/register')}
    >
      <AuthInput
        label="Guardian ID"
        icon="email-outline"
        placeholder="guardian@safelife.ai"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <AuthInput
        label="Access Cipher"
        icon="lock-outline"
        placeholder="••••••••"
        value={password}
        onChangeText={setPassword}
        secure
      />
      <GlowButton title="AUTHORIZE SESSION" onPress={handleLogin} loading={loading} />
    </AuthLayout>
  );
}
