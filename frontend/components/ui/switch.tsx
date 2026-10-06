'use client';

import * as React from 'react';
import { Switch as SwitchPrimitives } from 'radix-ui';
import {
  motion,
  type TargetAndTransition,
  type VariantLabels,
  type HTMLMotionProps,
  type LegacyAnimationControls,
} from 'motion/react';

import { getStrictContext } from '@/lib/get-strict-context';
import { cn } from '@/lib/utils';
import { useControlledState } from '@/hooks/use-controlled-state';

/**
 * The track and thumb, in the primitive (13a H11, H21).
 *
 * This was an unstyled animate-ui primitive: a bare `<Switch />` rendered at zero size, and
 * every call site copied the same track classes, whose checked thumb was `copy-primary` on an
 * `action-primary` track. In the dark theme both are near-white, so *on* could not be seen.
 * The checked thumb now takes `action-primary-contrast`, which is the action colour's own
 * foreground in both themes. Call sites pass only layout; the state is still written as text
 * beside the switch (design.md §8).
 */
const SWITCH_TRACK =
  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-line-control bg-surface-raised p-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-action-primary data-[state=checked]:bg-action-primary';
const SWITCH_THUMB =
  'block size-5 rounded-full bg-copy-secondary data-[state=checked]:translate-x-5 data-[state=checked]:bg-action-primary-contrast';

type SwitchContextType = {
  isChecked: boolean;
  setIsChecked: (isChecked: boolean) => void;
  isPressed: boolean;
  setIsPressed: (isPressed: boolean) => void;
};

const [SwitchProvider, useSwitch] =
  getStrictContext<SwitchContextType>('SwitchContext');

type SwitchProps = Omit<
  React.ComponentProps<typeof SwitchPrimitives.Root>,
  'asChild'
> &
  HTMLMotionProps<'button'>;

function Switch(props: SwitchProps) {
  const {
    checked,
    defaultChecked,
    onCheckedChange,
    disabled,
    name,
    value,
    required,
    form,
    ...buttonProps
  } = props;
  const [isPressed, setIsPressed] = React.useState(false);
  const [isChecked, setIsChecked] = useControlledState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });

  return (
    <SwitchProvider
      value={{ isChecked, setIsChecked, isPressed, setIsPressed }}
    >
      <SwitchPrimitives.Root
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={setIsChecked}
        disabled={disabled}
        name={name}
        value={value}
        required={required}
        form={form}
        asChild
      >
        <motion.button
          data-slot="switch"
          whileTap="tap"
          initial={false}
          onTapStart={() => setIsPressed(true)}
          onTapCancel={() => setIsPressed(false)}
          onTap={() => setIsPressed(false)}
          {...buttonProps}
          className={cn(SWITCH_TRACK, buttonProps.className)}
        />
      </SwitchPrimitives.Root>
    </SwitchProvider>
  );
}

type SwitchThumbProps = Omit<
  React.ComponentProps<typeof SwitchPrimitives.Thumb>,
  'asChild'
> &
  HTMLMotionProps<'div'> & {
    pressedAnimation?:
      | TargetAndTransition
      | VariantLabels
      | boolean
      | LegacyAnimationControls;
  };

function SwitchThumb({
  pressedAnimation,
  transition = { type: 'spring', stiffness: 300, damping: 25 },
  ...props
}: SwitchThumbProps) {
  const { isPressed } = useSwitch();

  return (
    <SwitchPrimitives.Thumb asChild>
      <motion.div
        data-slot="switch-thumb"
        whileTap="tab"
        layout
        transition={transition}
        animate={isPressed ? pressedAnimation : undefined}
        {...props}
        className={cn(SWITCH_THUMB, props.className)}
      />
    </SwitchPrimitives.Thumb>
  );
}

type SwitchIconPosition = 'left' | 'right' | 'thumb';

type SwitchIconProps = HTMLMotionProps<'div'> & {
  position: SwitchIconPosition;
};

function SwitchIcon({
  position,
  transition = { type: 'spring', bounce: 0 },
  ...props
}: SwitchIconProps) {
  const { isChecked } = useSwitch();

  const isAnimated = React.useMemo(() => {
    if (position === 'right') return !isChecked;
    if (position === 'left') return isChecked;
    if (position === 'thumb') return true;
    return false;
  }, [position, isChecked]);

  return (
    <motion.div
      data-slot={`switch-${position}-icon`}
      animate={isAnimated ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
      transition={transition}
      {...props}
    />
  );
}

export {
  Switch,
  SwitchThumb,
  SwitchIcon,
  useSwitch,
  type SwitchProps,
  type SwitchThumbProps,
  type SwitchIconProps,
  type SwitchIconPosition,
  type SwitchContextType,
};
