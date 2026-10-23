import { useState } from 'react';
import { useT } from './i18n';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { SettingsSelectProps, SettingsSwitchProps } from '@getpaseo/plugin/client/ui';

type Colors = PluginHostProps['theme']['colors'];
export function CompactSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
  colors: c,
  hideLabel = false,
}: SettingsSelectProps & { colors: Colors; hideLabel?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4, minWidth: 0, flex: hideLabel ? 1 : undefined }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 }}>
        {!hideLabel ? <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12 }}>{label}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          disabled={disabled}
          onPress={() => setOpen((v) => !v)}
          style={{
            flex: hideLabel ? 1 : undefined,
            minWidth: hideLabel ? 0 : 96,
            maxWidth: hideLabel ? '100%' : '65%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 6,
            paddingHorizontal: 10,
            minHeight: 32,
            backgroundColor: c.surface0,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text numberOfLines={1} style={{ flexShrink: 1, color: c.foreground, fontSize: 12 }}>
            {options.find((o) => o.value === value)?.label ?? t('Choisir…')}
          </Text>
          <Text style={{ color: c.foregroundMuted, marginLeft: 'auto' }}>{open ? '⌃' : '⌄'}</Text>
        </Pressable>
      </View>
      {open && !disabled ? (
        <ScrollView
          nestedScrollEnabled
          style={{
            maxHeight: 180,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 6,
            backgroundColor: c.surface1,
          }}
        >
          {options.length ? (
            options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`${label} : ${option.label}`}
                accessibilityState={{ selected: option.value === value }}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  backgroundColor: option.value === value ? c.surface2 : 'transparent',
                }}
              >
                <Text style={{ color: c.foreground, fontSize: 12 }}>
                  {option.value === value ? '✓ ' : ''}
                  {option.label}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={{ color: c.foregroundMuted, fontSize: 12, padding: 10 }}>Aucune option disponible.</Text>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function CompactSwitch({
  label,
  value,
  onValueChange,
  disabled,
  colors: c,
}: SettingsSwitchProps & { colors: Colors }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <View
        style={{
          width: 30,
          height: 18,
          borderRadius: 9,
          padding: 2,
          backgroundColor: value ? c.foreground : c.surface2,
          borderWidth: value ? 0 : 1,
          borderColor: c.border,
          alignItems: value ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View
          style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: value ? c.surface0 : c.foregroundMuted }}
        />
      </View>
    </Pressable>
  );
}
