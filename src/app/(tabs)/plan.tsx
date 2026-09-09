import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/kit';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function MealplanScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.ground, paddingTop: insets.top + space.xxl }}>
      <EmptyState
        title="Meal plan arrives in phase 4"
        body="Plan creation, the schedule, cook mode and automatic deduction land here. The ledger it reads from is what phase 1 builds."
      />
    </View>
  );
}
