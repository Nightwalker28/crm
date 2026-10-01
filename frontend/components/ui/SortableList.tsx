"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SortableItemControls = {
  index: number;
  count: number;
  /** The grip. Decorative: the drag is a pointer enhancement, the move buttons are the contract. */
  handle: ReactNode;
  /** Move up and move down, named for the item. The keyboard and assistive-tech path. */
  moveButtons: ReactNode;
};

type SortableListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  /** The item's name, in the move buttons' accessible names and in the announcement. */
  getItemLabel: (item: T) => string;
  /** Names the list. */
  label: string;
  /** Moves the item at `from` to `to`. Both are indices into `items`. */
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, controls: SortableItemControls) => ReactNode;
  disabled?: boolean;
  /** The list's layout — a stack, or the dashboard's widget grid. */
  className?: string;
  /** A per-item layout class, for a grid whose items span different widths. */
  itemClassName?: (item: T) => string | undefined;
};

/**
 * A list the operator can reorder (rebuild 5.7 ruling 4).
 *
 * Three pages each wrote HTML5 drag-and-drop by hand — the dashboard's widget grid, the view
 * manager's columns, and the module builder's fields — and each separately remembered that a
 * drag has no keyboard path, so each paired it with move buttons of its own: `ArrowUp` on two,
 * `ChevronUp` on the third, an announcement on one of the three. The pairing is the contract
 * here, not a courtesy:
 *
 * - **The move buttons are the accessible path**, and the drag is an enhancement over them.
 *   No drag library is added (§7.2): a visible button is more discoverable than a hidden
 *   keyboard sensor, and every call site already had one.
 * - **Focus follows the moved item.** Reordering keyed nodes moves the focused button in the
 *   DOM, and a moved node loses focus — so a keyboard user pressing *move up* twice was sent to
 *   the top of the page after the first press. The primitive puts focus back on the same
 *   control, or on its sibling when the item has reached the end it was moving towards.
 * - **Every move is announced**, politely: *"Pipeline funnel moved to position 3 of 11."*
 * - **The drop target is the strong line tier, not colour.** Two of the originals painted it
 *   with the primary action's tint.
 */
export function SortableList<T>({
  items,
  getKey,
  getItemLabel,
  label,
  onMove,
  renderItem,
  disabled = false,
  className,
  itemClassName,
}: SortableListProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ key: string; direction: "up" | "down" } | null>(null);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !listRef.current) return;
    pendingFocus.current = null;
    const row = Array.from(listRef.current.children).find(
      (child) => child instanceof HTMLElement && child.dataset.sortableKey === pending.key,
    );
    if (!(row instanceof HTMLElement)) return;
    const same = row.querySelector<HTMLButtonElement>(`[data-sortable-move="${pending.direction}"]`);
    const other = row.querySelector<HTMLButtonElement>(
      `[data-sortable-move="${pending.direction === "up" ? "down" : "up"}"]`,
    );
    (same && !same.disabled ? same : other)?.focus();
  });

  function move(from: number, to: number) {
    if (disabled || from === to || to < 0 || to >= items.length) return;
    onMove(from, to);
    setAnnouncement(`${getItemLabel(items[from])} moved to position ${to + 1} of ${items.length}.`);
  }

  function endDrag() {
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <>
      <ol
        ref={listRef}
        aria-label={label}
        data-slot="sortable-list"
        className={cn(
          // The drop target is outlined in the strong line tier and the item being dragged
          // recedes; neither is a colour. An outline, because the item's own box belongs to the
          // call site — a widget card, a divided row — and the primitive must mark it whatever
          // it draws.
          "[&>[data-drop-target=true]]:outline-2 [&>[data-drop-target=true]]:outline-offset-2 [&>[data-drop-target=true]]:outline-line-strong [&>[data-dragging=true]]:opacity-60",
          className,
        )}
      >
        {items.map((item, index) => {
          const key = getKey(item);
          const itemLabel = getItemLabel(item);
          const handle = disabled ? null : (
            <GripVertical className="size-4 shrink-0 cursor-grab text-copy-muted" aria-hidden="true" />
          );
          const moveButtons = disabled ? null : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-sortable-move="up"
                aria-label={`Move ${itemLabel} up`}
                disabled={index === 0}
                onClick={() => {
                  pendingFocus.current = { key, direction: "up" };
                  move(index, index - 1);
                }}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-sortable-move="down"
                aria-label={`Move ${itemLabel} down`}
                disabled={index === items.length - 1}
                onClick={() => {
                  pendingFocus.current = { key, direction: "down" };
                  move(index, index + 1);
                }}
              >
                <ArrowDown />
              </Button>
            </>
          );
          return (
            <li
              key={key}
              data-sortable-key={key}
              data-dragging={dragIndex === index || undefined}
              data-drop-target={(dropIndex === index && dragIndex !== null && dragIndex !== index) || undefined}
              draggable={!disabled}
              onDragStart={(event) => {
                if (disabled) return;
                event.dataTransfer.effectAllowed = "move";
                // Firefox starts no drag without data.
                event.dataTransfer.setData("text/plain", key);
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                if (disabled || dragIndex === null) return;
                event.preventDefault();
                if (dropIndex !== index) setDropIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={cn("rounded-[var(--radius-control)] transition-[opacity] duration-150 motion-reduce:transition-none", itemClassName?.(item))}
            >
              {renderItem(item, { index, count: items.length, handle, moveButtons })}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </>
  );
}
