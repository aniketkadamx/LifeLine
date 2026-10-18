import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogBackdrop = React.forwardRef<
  HTMLDivElement,
  DialogPrimitive.Backdrop.Props
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Backdrop
    ref={ref}
    data-slot="dialog-backdrop"
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-xs transition-all duration-200",
      className
    )}
    {...props}
  />
));
DialogBackdrop.displayName = "DialogBackdrop";

const DialogContent = React.forwardRef<
  HTMLDivElement,
  DialogPrimitive.Popup.Props & { showCloseButton?: boolean }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogBackdrop />
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <DialogPrimitive.Popup
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "relative w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-lg duration-200 focus:outline-none sm:rounded-2xl",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClose
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none disabled:pointer-events-none"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        )}
      </DialogPrimitive.Popup>
    </div>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-header"
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  DialogPrimitive.Title.Props
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  DialogPrimitive.Description.Props
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
