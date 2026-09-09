import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/kit';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function LibraryScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.ground, paddingTop: insets.top + space.xxl }}>
      <EmptyState
        title="Library arrives in phase 5"
        body="Saved and cooked recipes, reuse into the schedule, and adaptation to current stock. The ledger it reads from is what phase 1 builds."
      />
    </View>
  );
}
