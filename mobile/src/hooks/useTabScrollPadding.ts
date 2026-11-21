import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

/** Extra bottom space so scroll content clears the fixed tab bar. */
export function useTabScrollPadding(extra = 24) {
  const tabBarHeight = useBottomTabBarHeight();
  return tabBarHeight + extra;
}
