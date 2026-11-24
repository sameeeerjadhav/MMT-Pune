import React from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

const mark = require('../../assets/alstef-mark.png');

type Size = 'sm' | 'md' | 'lg' | 'hero';

const SIZES: Record<Size, number> = {
  sm: 28,
  md: 36,
  lg: 56,
  hero: 88,
};

type Props = {
  size?: Size;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

/** ALSTEF “A” mark — transparent background so it blends with the page chrome. */
export function BrandMark({ size = 'md', style, imageStyle }: Props) {
  const dim = SIZES[size];
  return (
    <View style={[styles.wrap, { width: dim, height: dim }, style]}>
      <Image
        source={mark}
        style={[styles.img, { width: dim, height: dim }, imageStyle]}
        resizeMode="contain"
        accessibilityLabel="ALSTEF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  img: {
    backgroundColor: 'transparent',
  },
});
