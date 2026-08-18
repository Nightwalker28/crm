'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  motion,
  AnimatePresence,
  type Transition,
  type HTMLMotionProps,
} from 'motion/react';

import { useDialogLayerCovered } from '@/components/ui/dialog-layer';
import { useControlledState } from '@/hooks/use-controlled-state';
import { cn } from "@/lib/utils";

// `lg` is the default and is reached by call sites that pass no size, so it stays even
// with no literal `size="lg"` in the app. `2xl` had neither, and the batch D migration
// said it would not carry dead surface forward.
const dialogPanelSizeClasses = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
  xl: "w-full max-w-xl",
  "3xl": "w-full max-w-3xl",
} as const;

type DialogProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Root>,
  'open' | 'onOpenChange'
> & {
  open?: boolean;
  defaultOpen?: boolean;
  onClose?: () => void;
  className?: string;
};

function Dialog({
  open,
  defaultOpen,
  onClose,
  modal,
  className,
  children,
  ...rest
}: DialogProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: open,
    defaultValue: defaultOpen,
    onChange: (next: boolean) => {
      if (!next) onClose?.();
    },
  });
  const covered = useDialogLayerCovered();

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      {...rest}
      open={isOpen}
      onOpenChange={setIsOpen}
      // While a confirmation sits on top, this dialog releases its own focus trap and
      // pointer lock so the dialog above it can be reached. See dialog-layer.tsx.
      modal={covered ? false : modal}
    >
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount data-slot="dialog-portal">
            <div className={cn("relative z-30", className)}>{children}</div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

type DialogBackdropProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Overlay>,
  'asChild' | 'forceMount'
> &
  HTMLMotionProps<'div'>;

function DialogBackdrop({
  transition = { duration: 0.15, ease: 'easeInOut' },
  className,
  ...rest
}: DialogBackdropProps) {
  return (
    <DialogPrimitive.Overlay asChild forceMount>
      <motion.div
        key="dialog-backdrop"
        data-slot="dialog-backdrop"
        className={cn(
          "fixed inset-0 bg-overlay backdrop-blur-sm",
          className
        )}
        initial={{ opacity: 0, filter: 'blur(4px)' }}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, filter: 'blur(4px)' }}
        transition={transition}
        {...rest}
      />
    </DialogPrimitive.Overlay>
  );
}

type DialogPanelProps = Omit<
  React.ComponentProps<typeof DialogPrimitive.Content>,
  'asChild' | 'forceMount' | 'onInteractOutside' | 'onEscapeKeyDown' | 'children'
> &
  Omit<HTMLMotionProps<'div'>, 'children'> & {
    children?: React.ReactNode;
    transition?: Transition;
    size?: keyof typeof dialogPanelSizeClasses;
    onInteractOutside?: (event: Event) => void;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
  };

/**
 * A dialog with no explanatory sentence passes `aria-describedby={undefined}`. Radix points
 * `aria-describedby` at a `DialogDescription` it expects to find and warns on every open when
 * there is none; the explicit `undefined` is its documented opt-out and says "this dialog is
 * named by its title alone" rather than silencing a real gap. Inventing description copy to
 * quiet the warning would be worse — that is the copy sweep's call (rebuild.md 5.9).
 */
function DialogPanel({
  children,
  transition = { type: 'spring', stiffness: 700, damping: 30 },
  size = 'lg',
  className,
  onInteractOutside,
  onEscapeKeyDown,
  ...rest
}: DialogPanelProps) {
  const covered = useDialogLayerCovered();

  // Releasing `modal` also hands dismissal back to Radix, which would treat a click on the
  // confirmation above as an outside interaction and close the panel underneath it. While
  // covered, the panel ignores outside interaction and Escape; the dialog on top owns both.
  const guardWhileCovered = <TEvent extends { preventDefault: () => void }>(
    handler: ((event: TEvent) => void) | undefined,
  ) => (event: TEvent) => {
    if (covered) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };

  return (
    <DialogPrimitive.Content
      asChild
      forceMount
      onInteractOutside={guardWhileCovered(onInteractOutside)}
      onEscapeKeyDown={guardWhileCovered(onEscapeKeyDown)}
      {...rest}
    >
      <motion.div
        key="dialog-panel"
        data-slot="dialog-panel"
        aria-hidden={covered || undefined}
        inert={covered}
        className={cn(
          "rounded-[var(--radius-dialog)] border border-line-default bg-surface-raised p-4 shadow-[var(--shadow-panel)]",
          dialogPanelSizeClasses[size],
          size === "3xl" && "max-h-[80vh] overflow-y-auto",
          className
        )}
        initial={{
          opacity: 0,
          filter: 'blur(4px)',
          transform: 'perspective(500px) rotateX(-20deg) scale(0.8)',
        }}
        animate={{
          opacity: 1,
          filter: 'blur(0px)',
          transform: 'perspective(500px) rotateX(0deg) scale(1)',
        }}
        exit={{
          opacity: 0,
          filter: 'blur(4px)',
          transform: 'perspective(500px) rotateX(-20deg) scale(0.8)',
        }}
        transition={transition}
      >
        {children}
      </motion.div>
    </DialogPrimitive.Content>
  );
}

type DialogCloseProps = React.ComponentProps<typeof DialogPrimitive.Close>;

function DialogClose(props: DialogCloseProps) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

type DialogHeaderProps = React.ComponentProps<'div'>;

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex items-start justify-between gap-3", className)}
      {...props}
    />
  );
}

type DialogFooterProps = React.ComponentProps<'div'>;

function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex gap-2 justify-end items-center", className)}
      {...props}
    />
  );
}

type DialogTitleProps = React.ComponentProps<typeof DialogPrimitive.Title>;

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-bold", className)}
      {...props}
    />
  );
}

type DialogDescriptionProps = React.ComponentProps<typeof DialogPrimitive.Description>;

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm", className)}
      {...props}
    />
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
};
