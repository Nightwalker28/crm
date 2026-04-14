import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";

interface DuplicateConfirmationProps {
  open: boolean;
  items: string[];
  onCancel: () => void;
  onChoose: (action: "replace" | "skip" | "create") => void;
}

export default function DuplicateConfirmation({
  open,
  items,
  onCancel,
  onChoose,
}: DuplicateConfirmationProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogBackdrop />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="max-w-lg w-full">
          {/* Header */}
          <div className="flex items-start gap-4 mb-4">
            <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>

            <div className="flex-1">
              <DialogTitle className="text-xl text-zinc-100 mb-1 text-left">
                Duplicate Records Found
              </DialogTitle>

              <DialogDescription className="text-zinc-400 text-left">
                The following {items.length} record
                {items.length > 1 ? "s" : ""} already exist in your database:
              </DialogDescription>
            </div>
          </div>

          {/* duplicate list */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-md p-4 mb-6 max-h-48 overflow-y-auto">
            <ul className="text-sm text-zinc-300 space-y-2">
              {items.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="break-all">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <DialogFooter className="mt-6 pt-4 border-t border-zinc-800 flex items-center justify-between">
            {/* Left: Cancel */}
            <Button onClick={onCancel} variant="ghost">
              Cancel Import
            </Button>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => onChoose("create")}
                variant="outline"
              >
                Create as New
              </Button>

              <Button
                onClick={() => onChoose("replace")}
                variant="default"
              >
                Replace Existing
              </Button>
            </div>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
