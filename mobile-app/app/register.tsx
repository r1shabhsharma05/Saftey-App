import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { supabase } from '../utils/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import AuthLayout from '../components/premium/AuthLayout';
import AuthInput from '../components/premium/AuthInput';
import GlowButton from '../components/premium/GlowButton';

const EMPTY = { firstName: '', lastName: '', email: '', password: '', phone: '', address: '' };

export default function PremiumRegisterScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(EMPTY);
  const set = (key: keyof typeof EMPTY) => (val: string) =>
    setFormData((f) => ({ ...f, [key]: val }));

  useFocusEffect(
    useCallback(() => {
      setFormData(EMPTY);
    }, [])
  );

  const showAlreadyRegisteredAlert = () => {
    Alert.alert('Already Registered', 'You are already registered. Redirecting to login…', [
      { text: 'OK', onPress: () => router.replace('/login') },
    ]);
  };

  const handleRegister = async () => {
    const { email, password, firstName, lastName, phone, address } = formData;

    if (!email || !password || !firstName || !phone) {
      Alert.alert('Incomplete', 'First name, email, password and phone are required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const nameRegex = /^[a-zA-Z\s]+$/;
    const digitsOnly = phone.replace(/\D/g, '');
    if (!emailRegex.test(email)) {
      Alert.alert('Invalid Format', 'Please enter a valid email address.');
      return;
    }
    if (!nameRegex.test(firstName) || (lastName && !nameRegex.test(lastName))) {
      Alert.alert('Invalid Format', 'Names can only contain letters and spaces.');
      return;
    }
    if (digitsOnly.length < 10) {
      Alert.alert('Invalid Format', 'Please enter a valid phone number (min 10 digits).');
      return;
    }

    setLoading(true);
    try {
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id')
        .or(`phone.eq.${phone},email.eq.${email}`)
        .maybeSingle();

      if (existingUser) {
        showAlreadyRegisteredAlert();
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes('already registered') || msg.includes('already been taken') || msg.includes('exists')) {
          showAlreadyRegisteredAlert();
          return;
        }
        throw authError;
      }

      if (authData?.user?.identities && authData.user.identities.length === 0) {
        showAlreadyRegisteredAlert();
        return;
      }

      if (authData?.user) {
        const uniqueId = `SL-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const { error: profileError } = await supabase.from('profiles').insert([
          {
            id: authData.user.id,
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            address,
            unique_id: uniqueId,
          },
        ]);

        if (profileError) {
          if (profileError.code === '23505') {
            showAlreadyRegisteredAlert();
            return;
          }
          throw profileError;
        }
        Alert.alert('System Initialized', `Welcome, Guardian. Your Unique ID is ${uniqueId}`);
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('unique')) {
        showAlreadyRegisteredAlert();
      } else {
        Alert.alert('Protocol Failure', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="System Initialization"
      subtitle="Enlist in the SafeLife AI Guardian Network"
      footerText="ALREADY REGISTERED?"
      footerLink="SIGN IN"
      onFooterPress={() => router.push('/login')}
    >
      <View style={styles.row}>
        <View style={styles.half}>
          <AuthInput label="First Name" icon="account-outline" placeholder="John" value={formData.firstName} onChangeText={set('firstName')} />
        </View>
        <View style={styles.half}>
          <AuthInput label="Last Name" icon="account-outline" placeholder="Doe" value={formData.lastName} onChangeText={set('lastName')} />
        </View>
      </View>
      <AuthInput
        label="Tactical Email"
        icon="email-outline"
        placeholder="guardian@safelife.ai"
        value={formData.email}
        onChangeText={set('email')}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <AuthInput
        label="Access Cipher"
        icon="lock-outline"
        placeholder="••••••••"
        value={formData.password}
        onChangeText={set('password')}
        secure
      />
      <AuthInput
        label="Comms Channel"
        icon="phone-outline"
        placeholder="+91 XXXXX XXXXX"
        value={formData.phone}
        onChangeText={set('phone')}
        keyboardType="phone-pad"
      />
      <AuthInput
        label="Deployment Base"
        icon="map-marker-outline"
        placeholder="Home base address"
        value={formData.address}
        onChangeText={set('address')}
        multiline
      />
      <GlowButton title="INITIALIZE PROFILE" onPress={handleRegister} loading={loading} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
