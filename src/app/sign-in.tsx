import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, ErrorNote, Field, Title } from '@/components/ui/kit';
import { errorMessage, supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError('Enter an email address and a password to continue.');
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setError('Passwords need to be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const { data, error: authError } =
        mode === 'sign-in'
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp(credentials);

      if (authError) throw authError;

      // With email confirmation switched on, sign-up returns a user but no
      // session. Say so plainly instead of appearing to hang.
      if (mode === 'sign-up' && !data.session) {
        setNotice('Check your inbox for a confirmation link, then sign in.');
        setMode('sign-in');
      }
      // The root layout routes on the session change; nothing to do here.
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: space.xl,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.md }}>
          <Title>Stockpot</Title>
          <Body>
            A shared pantry that knows what it holds, what is about to turn, and what to cook with it tonight.
          </Body>
        </View>

        <View style={{ gap: space.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            placeholder="At least 8 characters"
          />

          <ErrorNote message={error} />
          {notice ? (
            <View style={{ backgroundColor: t.accentWash, borderRadius: 6, padding: space.md }}>
              <Text style={{ color: t.accentText, fontSize: 14, lineHeight: 20 }}>{notice}</Text>
            </View>
          ) : null}

          <Button
            label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
            onPress={submit}
            busy={busy}
          />
          <Button
            label={mode === 'sign-in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            variant="ghost"
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
              setNotice(null);
            }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
