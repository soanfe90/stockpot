import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/kit';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ShoppingScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.ground, paddingTop: insets.top + space.xxl }}>
      <EmptyState
        title="Shopping arrives in phase 3"
        body="The list assembles itself from what ran out, ran low, or is about to expire. The ledger it reads from is what phase 1 builds."
      />
    </View>
  );
}
