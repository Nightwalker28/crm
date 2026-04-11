'use client';

import * as React from 'react';
import {
  Dialog as DialogPrimitive,
  DialogBackdrop as DialogBackdropPrimitive,
  DialogPanel as DialogPanelPrimitive,
  DialogTitle as DialogTitlePrimitive,
  Description as DialogDescriptionPrimitive,
  type DialogProps as DialogPrimitiveProps,
  type DialogBackdropProps as DialogBackdropPrimitiveProps,
  type DialogPanelProps as DialogPanelPrimitiveProps,
  type DialogTitleProps as DialogTitlePrimitiveProps,
  CloseButton,
  CloseButtonProps,
} from '@headlessui/react';
import {
  motion,
  AnimatePresence,
  type Transition,
  type HTMLMotionProps,
} from 'motion/react';
import { cn } from "@/lib/utils";

type DialogProps<TTag extends React.ElementType = 'div'> = Omit<
  DialogPrimitiveProps<TTag>,
  'static'
> & {
  className?: string;
  as?: TTag;
};

function Dialog<TTag extends React.ElementType = 'div'>({
  className,
  ...props
}: DialogProps<TTag>) {
  return (
    <AnimatePresence>
      {props?.open && (
        <DialogPrimitive
          data-slot="dialog"
          className={cn(
            "relative z-30",
            className
          )}
          {...props}
          static
        />
      )}
    </AnimatePresence>
  );
}

type DialogBackdropProps<TTag extends React.ElementType = typeof motion.div> =
  Omit<DialogBackdropPrimitiveProps<TTag>, 'transition'> &
    HTMLMotionProps<'div'> & {
      as?: TTag;
    };

function DialogBackdrop<TTag extends React.ElementType = typeof motion.div>(
  props: DialogBackdropProps<TTag>,
) {
  const {
    as = motion.div,
    transition = { duration: 0.15, ease: 'easeInOut' },
    className,
    ...rest
  } = props;

  return (
    <DialogBackdropPrimitive
      key="dialog-backdrop"
      data-slot="dialog-backdrop"
      as={as as React.ElementType}
      className={cn(
        "fixed inset-0 bg-black/60 backdrop-blur-sm",
        className
      )}
      initial={{ opacity: 0, filter: 'blur(4px)', transition }}
      animate={{ opacity: 1, filter: 'blur(0px)', transition }}
      exit={{ opacity: 0, filter: 'blur(4px)', transition }}
      {...rest}
    />
  );
}

type DialogFlipDirection = 'top' | 'bottom' | 'left' | 'right';

type DialogPanelProps<TTag extends React.ElementType = typeof motion.div> =
  Omit<DialogPanelPrimitiveProps<TTag>, 'transition'> &
    Omit<HTMLMotionProps<'div'>, 'children'> & {
      from?: DialogFlipDirection;
      transition?: Transition;
      as?: TTag;
    };

function DialogPanel<TTag extends React.ElementType = typeof motion.div>(
  props: DialogPanelProps<TTag>,
) {
  const {
    children,
    as = motion.div,
    from = 'top',
    transition = { type: 'spring', stiffness: 700, damping: 30 },
    className,
    ...rest
  } = props;

  const initialRotation =
    from === 'bottom' || from === 'left' ? '20deg' : '-20deg';
  const isVertical = from === 'top' || from === 'bottom';
  const rotateAxis = isVertical ? 'rotateX' : 'rotateY';

  return (
    <DialogPanelPrimitive
      key="dialog-panel"
      data-slot="dialog-panel"
      as={as as React.ElementType}
      className={cn(
        "bg-neutral-900 border border-neutral-800 rounded-md p-4",
        className
      )}
      initial={{
        opacity: 0,
        filter: 'blur(4px)',
        transform: `perspective(500px) ${rotateAxis}(${initialRotation}) scale(0.8)`,
        transition,
      }}
      animate={{
        opacity: 1,
        filter: 'blur(0px)',
        transform: `perspective(500px) ${rotateAxis}(0deg) scale(1)`,
        transition,
      }}
      exit={{
        opacity: 0,
        filter: 'blur(4px)',
        transform: `perspective(500px) ${rotateAxis}(${initialRotation}) scale(0.8)`,
        transition,
      }}
      {...rest}
    >
      {(bag) => (
        <>{typeof children === 'function' ? children(bag) : children}</>
      )}
    </DialogPanelPrimitive>
  );
}

type DialogCloseProps<TTag extends React.ElementType = 'div'> =
  CloseButtonProps<TTag> & {
    as?: TTag;
  };

function DialogClose<TTag extends React.ElementType = 'button'>(
  props: DialogCloseProps<TTag>,
) {
  const { as = 'button', ...rest } = props;

  return (
    <CloseButton
      data-slot="dialog-close"
      as={as as React.ElementType}
      {...rest}
    />
  );
}

type DialogHeaderProps<TTag extends React.ElementType = 'div'> =
  React.ComponentProps<TTag> & {
    as?: TTag;
  };

function DialogHeader<TTag extends React.ElementType = 'div'>({
  as: Component = 'div',
  ...props
}: DialogHeaderProps<TTag>) {
  return <Component data-slot="dialog-header" {...props} className={cn("flex justify-between items-center", props.className)}/>;
}

type DialogFooterProps<TTag extends React.ElementType = 'div'> =
  React.ComponentProps<TTag> & {
    as?: TTag;
  };

function DialogFooter({ as: Component = 'div', ...props }: DialogFooterProps) {
  return <Component data-slot="dialog-footer" {...props} className={cn("flex gap-2 justify-end items-center", props.className)}/>;
}

type DialogTitleProps<TTag extends React.ElementType = 'h2'> =
  DialogTitlePrimitiveProps<TTag> & {
    as?: TTag;
    className?: string;
  };

function DialogTitle<TTag extends React.ElementType = 'h2'>(
  props: DialogTitleProps<TTag>,
) {
  return <DialogTitlePrimitive data-slot="dialog-title" {...props} className={cn("font-bold", props.className)}/>;
}

type DialogDescriptionProps<TTag extends React.ElementType = 'div'> =
  React.ComponentProps<typeof DialogDescriptionPrimitive<TTag>> & {
    as?: TTag;
    className?: string;
  };

function DialogDescription<TTag extends React.ElementType = 'div'>(
  props: DialogDescriptionProps<TTag>,
) {
  return (
    <DialogDescriptionPrimitive data-slot="dialog-description" {...props} className={cn("text-sm", props.className)}/>
  );
}

export {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogClose,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  type DialogProps,
  type DialogBackdropProps,
  type DialogPanelProps,
  type DialogCloseProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogHeaderProps,
  type DialogFooterProps,
  type DialogFlipDirection,
};
