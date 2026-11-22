import React from 'react';
import { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { NavHeader } from '../components/PageHeader';
import { colors, fonts } from '../theme/tokens';

export function renderStackHeader(props: NativeStackHeaderProps) {
  const { navigation, options, back } = props;
  const title =
    typeof options.headerTitle === 'string'
      ? options.headerTitle
      : typeof options.title === 'string'
        ? options.title
        : '';

  return (
    <NavHeader
      title={title}
      canGoBack={Boolean(back)}
      onBack={() => navigation.goBack()}
      right={
        typeof options.headerRight === 'function'
          ? options.headerRight({ canGoBack: Boolean(back), tintColor: colors.navy })
          : undefined
      }
    />
  );
}

export const stackScreenOptions = {
  header: renderStackHeader,
  headerShadowVisible: false,
  headerTintColor: colors.navy,
  headerTitleStyle: { fontFamily: fonts.uiSemi, fontSize: 17, color: colors.navy },
  headerTitleAlign: 'left' as const,
  contentStyle: { backgroundColor: colors.background },
  headerBackTitleVisible: false,
  headerStyle: { backgroundColor: colors.background },
};
