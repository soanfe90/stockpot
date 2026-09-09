import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, ErrorNote, Field, Segmented, Title } from '@/components/ui/kit';
import { errorMessage } from '@/lib/supabase';
import { useHousehold } from '@/providers/household-provider';
import { useSession } from '@/providers/session-provider';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

type Mode = 'create' | 'join';

export default function HouseholdScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { createHousehold, joinHousehold } = useHousehold();
  const { signOut } = useSession();

  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [size, setSize] = useState('2');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        if (!name.trim()) throw new Error('Give the household a name.');
        const parsed = Number.parseInt(size, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
          throw new Error('How many people eat here? Enter a number from 1 to 20.');
        }
        await createHousehold(name.trim(), parsed);
      } else {
        if (code.trim().length < 4) throw new Error('Invite codes are six characters.');
        await joinHousehold(code.trim());
      }
      // The root layout routes once the household lands.
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
          <Title>Set up your household</Title>
          <Body>
            Everything in Stockpot belongs to a household, not to you: inventory, plans and lists are shared with
            whoever you invite.
          </Body>
        </View>

        <Segmented
          options={[
            { value: 'create', label: 'Start a household' },
            { value: 'join', label: 'Join with a code' },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
        />

        <Card>
          {mode === 'create' ? (
            <View style={{ gap: space.lg }}>
              <Field
                label="Household name"
                value={name}
                onChangeText={setName}
                placeholder="Casa Fernández"
                autoCapitalize="words"
              />
              <Field
                label="How many people eat here"
                value={size}
                onChangeText={setSize}
                keyboardType="number-pad"
                suffix="people"
                hint="Portions, deductions and shopping quantities are all sized from this. It matters more than it looks."
              />
            </View>
          ) : (
            <Field
              label="Invite code"
              value={code}
              onChangeText={(value) => setCode(value.toUpperCase())}
              placeholder="K7RM2P"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              hint="Ask whoever set up the household — it is on their inventory screen."
            />
          )}
        </Card>

        <ErrorNote message={error} />

        <View style={{ gap: space.sm }}>
          <Button label={mode === 'create' ? 'Create household' : 'Join household'} onPress={submit} busy={busy} />
          <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
